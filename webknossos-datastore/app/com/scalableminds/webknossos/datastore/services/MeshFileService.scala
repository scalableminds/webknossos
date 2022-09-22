package com.scalableminds.webknossos.datastore.services

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.geometry.Vec3Int
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
//      val chunkPositionLiterals = cachedMeshFile.reader
//        .`object`()
//        .getAllGroupMembers(s"/${listMeshChunksRequest.segmentId}/$defaultLevelOfDetail")
//        .asScala
//        .toList
//      Fox.serialCombined(chunkPositionLiterals)(parsePositionLiteral)
      val segmentId = listMeshChunksRequest.segmentId
      val (neuroglancerStart, neuroglancerEnd) = getNeuroglancerOffsets(segmentId, cachedMeshFile)
      val manifest = cachedMeshFile.reader
        .uint8()
        .readArrayBlockWithOffset("neuroglancer", (neuroglancerEnd - neuroglancerStart).toInt, neuroglancerStart)
      val byteInput = new ByteArrayInputStream(manifest)
      val dis = new LittleEndianDataInputStream(byteInput)
      // todo use vec3int
      val chunkShape = new Array[Float](3)
      for (d <- 0 until 3) {
        chunkShape(d) = dis.readFloat
      }
      // todo use vec3int
      val gridOrigin = new Array[Float](3)
      for (d <- 0 until 3) {
        gridOrigin(d) = dis.readFloat
      }
      // TODO should uint
      val numLods = dis.readInt()
      val lodScales = new Array[Float](numLods)
      for (d <- 0 until numLods) {
        lodScales(d) = dis.readFloat()
      }
      // TODO use vec3int
      val vertexOffsets = new Array[Array[Float]](numLods)
      for (d <- 0 until numLods) {
        for (x <- 0 until 3) {
          vertexOffsets(d)(x) = dis.readFloat()
        }
      }
      // TODO should be uint
      val numFragmentsPerLod = new Array[Int](numLods)
      for (lod <- 0 until numLods) {
        numFragmentsPerLod(lod) = dis.readInt()
      }
      // TODO should be uint
      val fragmentPositions = new Array[Array[Array[Int]]](numLods)
      val fragmentPositionsVec3 = new Array[Array[Vec3Int]](numLods)
      val fragmentOffsets = new Array[Array[Int]](numLods)
      for (lod <- 0 until numLods) {
        // TODO is that the right order??
        for (row <- 0 until 3) {
          for (col <- 0 until numFragmentsPerLod(lod)) {
            fragmentPositions(lod)(row)(col) = dis.readInt()
          }
        }
        // TODO make functional, this is a mess
        for (col <- 0 until numFragmentsPerLod(lod)) {
          fragmentPositionsVec3(lod)(col) =
            Vec3Int(fragmentPositions(lod)(0)(col), fragmentPositions(lod)(1)(col), fragmentPositions(lod)(2)(col))
        }

        for (row <- 0 until numFragmentsPerLod(lod)) {
          fragmentOffsets(lod)(row) = dis.readInt()
        }
      }
      val DEFAULT_LOD = 1
      fragmentPositionsVec3(DEFAULT_LOD).toList
    }
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
