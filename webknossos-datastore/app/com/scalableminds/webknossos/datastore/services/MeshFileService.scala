package com.scalableminds.webknossos.datastore.services

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Json, OFormat}

import java.io.ByteArrayInputStream
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.collection.JavaConverters._
import scala.concurrent.ExecutionContext
import scala.util.Using

trait GenericJsonFormat[T] {}

case class ListMeshChunksRequest(
    meshFile: String,
    segmentId: Long
)

object ListMeshChunksRequest {
  implicit val jsonFormat: OFormat[ListMeshChunksRequest] = Json.format[ListMeshChunksRequest]
}

case class MeshChunkDataRequest(
    meshFile: String,
    position: Vec3Int,
    segmentId: Long
)

object MeshChunkDataRequest {
  implicit val jsonFormat: OFormat[MeshChunkDataRequest] = Json.format[MeshChunkDataRequest]
}

case class MeshFileNameWithMappingName(
    meshFileName: String,
    mappingName: Option[String]
)

object MeshFileNameWithMappingName {
  implicit val jsonFormat: OFormat[MeshFileNameWithMappingName] = Json.format[MeshFileNameWithMappingName]
}

case class NeuroglancerSegmentInfo(chunkShape: Vec3Float,
                                   gridOrigin: Vec3Float,
                                   numLods: Int,
                                   lodScales: Array[Float],
                                   vertexOffsets: Array[Vec3Float],
                                   numFragmentsPerLod: Array[Int],
                                   fragmentPositions: Array[Array[Vec3Int]],
                                   fragmentOffsets: Array[Array[Int]])

case class MeshfileFragment(position: Vec3Float, byteOffset: Int, byteSize: Int)

case class MeshfileLod(scale: Int, vertexOffset: Vec3Float, chunkShape: Vec3Float, fragments: List[MeshfileFragment])

case class Meshfile(chunkShape: Vec3Float, gridOrigin: Vec3Float, lods: List[MeshfileLod])

class MeshFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val meshesDir = "meshes"
  private val meshFileExtension = "hdf5"
  private val defaultLevelOfDetail = 0
  private def hashFn: Long => Long = identity

  private lazy val meshFileCache = new Hdf5FileCache(30)

  def exploreMeshFiles(organizationName: String,
                       dataSetName: String,
                       dataLayerName: String): Fox[Set[MeshFileNameWithMappingName]] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName)
    val meshFileNames = PathUtils
      .listFiles(layerDir.resolve(meshesDir), PathUtils.fileExtensionFilter(meshFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
    val mappingNameFoxes = meshFileNames.map { fileName =>
      val meshFilePath = layerDir.resolve(meshesDir).resolve(s"$fileName.$meshFileExtension")
      mappingNameForMeshFile(meshFilePath)
    }
    for {
      mappingNameBoxes: Seq[Box[String]] <- Fox.sequence(mappingNameFoxes)
      mappingNameOptions = mappingNameBoxes.map(_.toOption)
      zipped = meshFileNames.zip(mappingNameOptions).toSet
    } yield zipped.map(tuple => MeshFileNameWithMappingName(tuple._1, tuple._2))
  }

  /*
   Note that null is a valid value here for once. Meshfiles with no information about the
   meshFilePath will return Fox.empty, while meshfiles with one marked as empty, will return Fox.successful(null)
   */

  def mappingNameForMeshFile(meshFilePath: Path): Fox[String] =
    safeExecute(meshFilePath) { cachedMeshFile =>
      cachedMeshFile.reader.string().getAttr("/", "metadata/mapping_name")
    } ?~> "mesh.file.readEncoding.failed"

  def listMeshChunksForSegment(organizationName: String,
                               dataSetName: String,
                               dataLayerName: String,
                               listMeshChunksRequest: ListMeshChunksRequest): Fox[List[Vec3Int]] = {
    val meshFilePath =
      dataBaseDir
        .resolve(organizationName)
        .resolve(dataSetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"${listMeshChunksRequest.meshFile}.$meshFileExtension")

    safeExecute(meshFilePath) { cachedMeshFile =>
      val chunkPositionLiterals = cachedMeshFile.reader
        .`object`()
        .getAllGroupMembers(s"/${listMeshChunksRequest.segmentId}/$defaultLevelOfDetail")
        .asScala
        .toList
      Fox.serialCombined(chunkPositionLiterals)(parsePositionLiteral)
    }.flatten ?~> "mesh.file.open.failed"
  }

  def listMeshChunksForSegmentNewFormat(organizationName: String,
                                        dataSetName: String,
                                        dataLayerName: String,
                                        listMeshChunksRequest: ListMeshChunksRequest): Fox[List[Vec3Int]] = {
    val meshFilePath =
      dataBaseDir
        .resolve(organizationName)
        .resolve(dataSetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"${listMeshChunksRequest.meshFile}.$meshFileExtension")

    safeExecute(meshFilePath) { cachedMeshFile =>
      val segmentId = listMeshChunksRequest.segmentId
      val (neuroglancerStart, neuroglancerEnd) = getNeuroglancerOffsets(segmentId, cachedMeshFile)
      // TODO transform is actually a matrix
      val transform = cachedMeshFile.reader.float32().getAttr("/", "metadata/transform")
      val manifest = cachedMeshFile.reader
        .uint8()
        .readArrayBlockWithOffset("neuroglancer", (neuroglancerEnd - neuroglancerStart).toInt, neuroglancerStart)
      val segmentInfo = parseNeuroglancerManifest(manifest)
      val meshfile = getFragmentsFromSegmentInfo(segmentInfo, transform, neuroglancerStart)
      // TODO we need more info than just this, frontend probably needs also quantization bit
      segmentInfo.fragmentPositions(defaultLevelOfDetail).toList
    }
  }

  private def getFragmentsFromSegmentInfo(segmentInfo: NeuroglancerSegmentInfo,
                                          transform: Float,
                                          neuroglancerOffsetStart: Long): Meshfile = {
    val totalMeshSize = segmentInfo.fragmentOffsets.reduce((a, b) => a.sum + b.sum)
    val meshByteStartOffset = neuroglancerOffsetStart - totalMeshSize
    val fragmentByteOffsets = segmentInfo.fragmentOffsets.map(_.scanLeft(0)(_ + _))

    def computeGlobalPositionAndOffset(lod: Int, currentFragment: Int): MeshfileFragment = {
      val globalPosition = segmentInfo.gridOrigin + segmentInfo
        .fragmentPositions(lod)(currentFragment)
        .toVec3Float * segmentInfo.chunkShape * segmentInfo.lodScales(lod)

      MeshfileFragment(
        position = globalPosition * transform,
        byteOffset = meshByteStartOffset.toInt + fragmentByteOffsets(lod)(currentFragment),
        byteSize = segmentInfo.fragmentOffsets(lod)(currentFragment),
      )
    }

    val lods = for (lod <- 0 until segmentInfo.numLods) yield lod

    def fragmentNums(lod: Int): IndexedSeq[(Int, Int)] =
      for (currentFragment <- 0 until segmentInfo.numFragmentsPerLod(lod))
        yield (lod, currentFragment)
    val fragments = lods.map(lod => fragmentNums(lod).map(x => computeGlobalPositionAndOffset(x._1, x._2)).toList)

    val meshfileLods = lods.map(
      lod =>
        MeshfileLod(scale = segmentInfo.lodScales(lod).toInt,
                    vertexOffset = segmentInfo.vertexOffsets(lod),
                    chunkShape = segmentInfo.chunkShape,
                    fragments = fragments(lod))).toList
    Meshfile(chunkShape = segmentInfo.chunkShape, gridOrigin = segmentInfo.gridOrigin, lods = meshfileLods)
  }
  private def parseNeuroglancerManifest(manifest: Array[Byte]): NeuroglancerSegmentInfo = {
    // All Ints here should be UInt32 per spec.
    // But they all are used to index into Arrays and JVM doesn't allow for Long Array Indexes,
    // we can't convert them.
    // TODO Check whether limit exceeded for the Ints.
    val byteInput = new ByteArrayInputStream(manifest)
    val dis = new LittleEndianDataInputStream(byteInput)

    val chunkShape = Vec3Float(x = dis.readFloat, y = dis.readFloat, z = dis.readFloat)
    val gridOrigin = Vec3Float(x = dis.readFloat, y = dis.readFloat, z = dis.readFloat)

    val numLods = dis.readInt

    val lodScales = new Array[Float](numLods)
    for (d <- 0 until numLods) {
      lodScales(d) = dis.readFloat
    }

    val vertexOffsets = new Array[Vec3Float](numLods)
    for (d <- 0 until numLods) {
      vertexOffsets(d) = Vec3Float(x = dis.readFloat, y = dis.readFloat, z = dis.readFloat)
    }

    val numFragmentsPerLod = new Array[Int](numLods)
    for (lod <- 0 until numLods) {
      numFragmentsPerLod(lod) = dis.readInt()
    }

    val fragmentPositions = new Array[Array[Array[Int]]](numLods)
    val fragmentPositionsVec3 = new Array[Array[Vec3Int]](numLods)
    val fragmentSizes = new Array[Array[Int]](numLods)
    for (lod <- 0 until numLods) {
      for (row <- 0 until 3) {
        for (col <- 0 until numFragmentsPerLod(lod)) {
          fragmentPositions(lod)(row)(col) = dis.readInt
        }
      }

      fragmentPositionsVec3(lod) = fragmentPositions(lod).transpose.map(xs => Vec3Int(xs(0), xs(1), xs(2)))

      for (fragmentNum <- 0 until numFragmentsPerLod(lod)) {
        fragmentSizes(lod)(fragmentNum) = dis.readInt
      }
    }

    NeuroglancerSegmentInfo(chunkShape,
                            gridOrigin,
                            numLods,
                            lodScales,
                            vertexOffsets,
                            numFragmentsPerLod,
                            fragmentPositionsVec3,
                            fragmentSizes)
  }

  private def getNeuroglancerOffsets(segmentId: Long, cachedMeshFile: CachedHdf5File): (Long, Long) = {
    val nBuckets = cachedMeshFile.reader.uint64().getAttr("/", "metadata/n_buckets")
    // TODO get hashfunction from metadata
    val bucketIndex = hashFn(segmentId) % nBuckets
    val cappedBucketIndex = bucketIndex.toInt
    val bucketOffsets = cachedMeshFile.reader.uint64().readArrayBlockWithOffset("bucket_offsets", 2, bucketIndex)
    val bucketStart = bucketOffsets(cappedBucketIndex)
    val cappedBucketStart = bucketStart.toInt
    val bucketEnd = bucketOffsets(cappedBucketIndex + 1)
    val cappedBucketEnd = bucketEnd.toInt
    // TODO is this access correct?
    val buckets = cachedMeshFile.reader
      .uint64()
      .readMatrixBlockWithOffset("buckets", cappedBucketEnd - cappedBucketStart + 1, 3, bucketStart, 0)
    // TODO does this work as intended?
    val bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
    val neuroglancerStart = buckets(bucketLocalOffset)(1)
    val neuroglancerEnd = buckets(bucketLocalOffset)(2)
    (neuroglancerStart, neuroglancerEnd)
  }

  def readMeshChunk(organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    meshChunkDataRequest: MeshChunkDataRequest): Fox[(Array[Byte], String)] = {
    val meshFilePath = dataBaseDir
      .resolve(organizationName)
      .resolve(dataSetName)
      .resolve(dataLayerName)
      .resolve(meshesDir)
      .resolve(s"${meshChunkDataRequest.meshFile}.$meshFileExtension")

    safeExecute(meshFilePath) { cachedMeshFile =>
      val encoding = cachedMeshFile.reader.string().getAttr("/", "metadata/encoding")
      val key =
        s"/${meshChunkDataRequest.segmentId}/$defaultLevelOfDetail/${positionLiteral(meshChunkDataRequest.position)}"
      val data = cachedMeshFile.reader.readAsByteArray(key)
      (data, encoding)
    } ?~> "mesh.file.readData.failed"
  }


  def readMeshChunkNewFormat(organizationName: String,
                    dataSetName: String,
                    dataLayerName: String,
                    meshChunkDataRequest: MeshChunkDataRequest, fragmentStartOffset: Long, fragmentSize: Int): Fox[(Array[Byte], String)] = {
    val meshFilePath = dataBaseDir
      .resolve(organizationName)
      .resolve(dataSetName)
      .resolve(dataLayerName)
      .resolve(meshesDir)
      .resolve(s"${meshChunkDataRequest.meshFile}.$meshFileExtension")

    safeExecute(meshFilePath) { cachedMeshFile =>
      val meshFormat = cachedMeshFile.reader.string().getAttr("/", "metadata/mesh_format")
      val data = cachedMeshFile.reader.uint8().readArrayBlockWithOffset("neuroglancer", fragmentSize, fragmentStartOffset)
      (data, meshFormat)
    } ?~> "mesh.file.readData.failed"
  }

  private def safeExecute[T](filePath: Path)(block: CachedHdf5File => T): Fox[T] =
    for {
      _ <- bool2Fox(filePath.toFile.exists()) ?~> "mesh.file.open.failed"
      result <- Using(meshFileCache.withCache(filePath)(CachedHdf5File.fromPath)) {
        block
      }.toFox
    } yield result

  private def positionLiteral(position: Vec3Int) =
    s"${position.x}_${position.y}_${position.z}"

  private def parsePositionLiteral(positionLiteral: String): Fox[Vec3Int] = {
    val split = positionLiteral.split("_").toList
    for {
      _ <- bool2Fox(split.length == 3)
      asInts <- tryo { split.map(_.toInt) }
    } yield Vec3Int(asInts.head, asInts(1), asInts(2))
  }

}
