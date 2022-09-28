package com.scalableminds.webknossos.datastore.services

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Full}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.codec.digest.MurmurHash3
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Json, OFormat}

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.file.{Files, Path, Paths}
import javax.inject.Inject
import scala.collection.JavaConverters._
import scala.collection.mutable.ListBuffer
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

case class MeshChunkDataRequestV0(
    meshFile: String,
    position: Vec3Int,
    segmentId: Long
)

case class MeshChunkDataRequestV1(
    meshFile: String,
    fragmentStartOffset: Long,
    fragmentSize: Int
)

object MeshChunkDataRequestV0 {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestV0] = Json.format[MeshChunkDataRequestV0]
}

object MeshChunkDataRequestV1 {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestV1] = Json.format[MeshChunkDataRequestV1]
}

case class MeshFileInfo(
    meshFileName: String,
    mappingName: Option[String],
    formatVersion: Long
)

object MeshFileInfo {
  implicit val jsonFormat: OFormat[MeshFileInfo] = Json.format[MeshFileInfo]
}

case class NeuroglancerSegmentInfo(chunkShape: Vec3Float,
                                   gridOrigin: Vec3Float,
                                   numLods: Int,
                                   lodScales: Array[Float],
                                   vertexOffsets: Array[Vec3Float],
                                   numFragmentsPerLod: Array[Int],
                                   fragmentPositions: List[List[Vec3Int]],
                                   fragmentOffsets: List[List[Int]])

case class MeshFragment(position: Vec3Float, byteOffset: Int, byteSize: Int)

object MeshFragment {
  implicit val jsonFormat: OFormat[MeshFragment] = Json.format[MeshFragment]
}
case class MeshLodInfo(scale: Int, vertexOffset: Vec3Float, chunkShape: Vec3Float, fragments: List[MeshFragment])

object MeshLodInfo {
  implicit val jsonFormat: OFormat[MeshLodInfo] = Json.format[MeshLodInfo]
}
case class MeshSegmentInfo(chunkShape: Vec3Float, gridOrigin: Vec3Float, lods: List[MeshLodInfo])

object MeshSegmentInfo {
  implicit val jsonFormat: OFormat[MeshSegmentInfo] = Json.format[MeshSegmentInfo]
}
case class WebknossosSegmentInfo(transform: Array[Array[Double]], meshFormat: String, chunks: MeshSegmentInfo)

object WebknossosSegmentInfo {
  implicit val jsonFormat: OFormat[WebknossosSegmentInfo] = Json.format[WebknossosSegmentInfo]
}

class MeshFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val meshesDir = "meshes"
  private val meshFileExtension = "hdf5"
  private val defaultLevelOfDetail = 0
  private def getHashFunction(name: String): Long => Long = name match {
    case "identity" => identity
    case "murmurhash3_x64_128" =>
      x: Long =>
        Math.abs(MurmurHash3.hash128x64(ByteBuffer.allocate(8).putLong(x).array())(1))
  }

  private lazy val meshFileCache = new Hdf5FileCache(30)

  def readDummyDraco(): Fox[Array[Byte]] = {
    val path = dataBaseDir.resolve("draco_file.bin")
    tryo(Files.readAllBytes(path)).toOption.toFox
  }

  def exploreMeshFiles(organizationName: String, dataSetName: String, dataLayerName: String): Fox[Set[MeshFileInfo]] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName)
    val meshFileNames = PathUtils
      .listFiles(layerDir.resolve(meshesDir), PathUtils.fileExtensionFilter(meshFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)

    val meshFileVersions = meshFileNames.map { fileName =>
      val meshFilePath = layerDir.resolve(meshesDir).resolve(s"$fileName.$meshFileExtension")
      mappingVersionForMeshFile(meshFilePath)
    }

    val mappingNameFoxes = (meshFileNames, meshFileVersions).zipped.map { (fileName, fileVersion) =>
      val meshFilePath = layerDir.resolve(meshesDir).resolve(s"$fileName.$meshFileExtension")
      mappingNameForMeshFile(meshFilePath, fileVersion)
    }

    for {
      mappingNameBoxes: Seq[Box[String]] <- Fox.sequence(mappingNameFoxes)

      mappingNameOptions = mappingNameBoxes.map(_.toOption)
      zipped = (meshFileNames, mappingNameOptions, meshFileVersions).zipped
    } yield zipped.map(MeshFileInfo(_, _, _)).toSet
  }

  /*
   Note that null is a valid value here for once. Meshfiles with no information about the
   meshFilePath will return Fox.empty, while meshfiles with one marked as empty, will return Fox.successful(null)
   */
  def mappingNameForMeshFile(meshFilePath: Path, meshFileVersion: Long): Fox[String] =
    if (meshFileVersion == 0) {
      safeExecute(meshFilePath) { cachedMeshFile =>
        cachedMeshFile.reader.string().getAttr("/", "metadata/mapping_name")
      } ?~> "mesh.file.readEncoding.failed"
    } else {
      safeExecute(meshFilePath) { cachedMeshFile =>
        cachedMeshFile.reader.string().getAttr("/", "mapping_name")
      } ?~> "mesh.file.readEncoding.failed"
    }

  def mappingVersionForMeshFile(meshFilePath: Path): Long =
    safeExecuteBox(meshFilePath) { cachedMeshFile =>
      cachedMeshFile.reader.int64().getAttr("/", "version")
    }.toOption.getOrElse(0)

  def listMeshChunksForSegmentV0(organizationName: String,
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

  def listMeshChunksForSegmentV1(organizationName: String,
                                 dataSetName: String,
                                 dataLayerName: String,
                                 listMeshChunksRequest: ListMeshChunksRequest): Fox[WebknossosSegmentInfo] = {
    val meshFilePath =
      dataBaseDir
        .resolve(organizationName)
        .resolve(dataSetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"${listMeshChunksRequest.meshFile}.$meshFileExtension")

    safeExecute(meshFilePath) { cachedMeshFile =>
      val segmentId = listMeshChunksRequest.segmentId
      val encoding = cachedMeshFile.reader.string().getAttr("/", "mesh_format")
      val lodScaleMultiplier = cachedMeshFile.reader.float64().getAttr("/", "lod_scale_multiplier")
      val transform = cachedMeshFile.reader.float64().getMatrixAttr("/", "transform")

      val (neuroglancerStart, neuroglancerEnd) = getNeuroglancerOffsets(segmentId, cachedMeshFile)

      val manifest = cachedMeshFile.reader
        .uint8()
        .readArrayBlockWithOffset("/neuroglancer", (neuroglancerEnd - neuroglancerStart).toInt, neuroglancerStart)
      val segmentInfo = parseNeuroglancerManifest(manifest)
      val meshfile = getFragmentsFromSegmentInfo(segmentInfo, lodScaleMultiplier, neuroglancerStart)
      meshfile
        .map(meshInfo => WebknossosSegmentInfo(transform = transform, meshFormat = encoding, chunks = meshInfo))
        .toFox
    }.flatten
  }

  private def getFragmentsFromSegmentInfo(segmentInfo: NeuroglancerSegmentInfo,
                                          lodScaleMultiplier: Double,
                                          neuroglancerOffsetStart: Long): Option[MeshSegmentInfo] = {
    val totalMeshSize = segmentInfo.fragmentOffsets.map(_.sum).sum
    val meshByteStartOffset = neuroglancerOffsetStart - totalMeshSize
    val fragmentByteOffsets = segmentInfo.fragmentOffsets.map(_.scanLeft(0)(_ + _)) // This builds a cumulative sum

    def computeGlobalPositionAndOffset(lod: Int, currentFragment: Int): MeshFragment = {
      val globalPosition = segmentInfo.gridOrigin + segmentInfo
        .fragmentPositions(lod)(currentFragment)
        .toVec3Float * segmentInfo.chunkShape * segmentInfo.lodScales(lod) * lodScaleMultiplier

      MeshFragment(
        position = globalPosition, // This position is in Voxel Space
        byteOffset = meshByteStartOffset.toInt + fragmentByteOffsets(lod)(currentFragment),
        byteSize = segmentInfo.fragmentOffsets(lod)(currentFragment),
      )
    }

    val lods = for (lod <- 0 until segmentInfo.numLods) yield lod

    def fragmentNums(lod: Int): IndexedSeq[(Int, Int)] =
      for (currentFragment <- 0 until segmentInfo.numFragmentsPerLod(lod))
        yield (lod, currentFragment)
    val fragments = lods.map(lod => fragmentNums(lod).map(x => computeGlobalPositionAndOffset(x._1, x._2)).toList)

    val meshfileLods = lods
      .map(
        lod =>
          MeshLodInfo(scale = segmentInfo.lodScales(lod).toInt,
                      vertexOffset = segmentInfo.vertexOffsets(lod),
                      chunkShape = segmentInfo.chunkShape,
                      fragments = fragments(lod)))
      .toList
    Some(MeshSegmentInfo(chunkShape = segmentInfo.chunkShape, gridOrigin = segmentInfo.gridOrigin, lods = meshfileLods))
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

    // TODO what if there are no fragments?
    val fragmentPositionsList = new ListBuffer[List[Vec3Int]]
    val fragmentSizes = new ListBuffer[List[Int]]
    for (lod <- 0 until numLods) {
      val currentFragmentPositions = (ListBuffer[Int](), ListBuffer[Int](), ListBuffer[Int]())
      for (row <- 0 until 3; _ <- 0 until numFragmentsPerLod(lod)) {
        row match {
          case 0 => currentFragmentPositions._1.append(dis.readInt)
          case 1 => currentFragmentPositions._2.append(dis.readInt)
          case 2 => currentFragmentPositions._3.append(dis.readInt)
        }
      }

      fragmentPositionsList.append(currentFragmentPositions.zipped.map(Vec3Int(_, _, _)).toList)

      val currentFragmentSizes = ListBuffer[Int]()
      for (_ <- 0 until numFragmentsPerLod(lod)) {
        currentFragmentSizes.append(dis.readInt)
      }
      fragmentSizes.append(currentFragmentSizes.toList)
    }

    NeuroglancerSegmentInfo(chunkShape,
                            gridOrigin,
                            numLods,
                            lodScales,
                            vertexOffsets,
                            numFragmentsPerLod,
                            fragmentPositionsList.toList,
                            fragmentSizes.toList)
  }

  private def getNeuroglancerOffsets(segmentId: Long, cachedMeshFile: CachedHdf5File): (Long, Long) = {
    val nBuckets = cachedMeshFile.reader.uint64().getAttr("/", "n_buckets")
    val hashName = cachedMeshFile.reader.string().getAttr("/", "hash_function")

    val bucketIndex = getHashFunction(hashName)(segmentId) % nBuckets
    val bucketOffsets = cachedMeshFile.reader.uint64().readArrayBlockWithOffset("bucket_offsets", 2, bucketIndex)
    val bucketStart = bucketOffsets(0)
    val bucketEnd = bucketOffsets(1)

    val buckets = cachedMeshFile.reader
      .uint64()
      .readMatrixBlockWithOffset("buckets", (bucketEnd - bucketStart + 1).toInt, 3, bucketStart, 0)

    // TODO what if you don't find segment
    val bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
    val neuroglancerStart = buckets(bucketLocalOffset)(1)
    val neuroglancerEnd = buckets(bucketLocalOffset)(2)

    (neuroglancerStart, neuroglancerEnd)
  }

  def readMeshChunkV0(organizationName: String,
                      dataSetName: String,
                      dataLayerName: String,
                      meshChunkDataRequest: MeshChunkDataRequestV0): Fox[(Array[Byte], String)] = {
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

  def readMeshChunkV1(organizationName: String,
                      dataSetName: String,
                      dataLayerName: String,
                      meshChunkDataRequest: MeshChunkDataRequestV1,
  ): Fox[(Array[Byte], String)] = {
    val meshFilePath = dataBaseDir
      .resolve(organizationName)
      .resolve(dataSetName)
      .resolve(dataLayerName)
      .resolve(meshesDir)
      .resolve(s"${meshChunkDataRequest.meshFile}.$meshFileExtension")

    safeExecute(meshFilePath) { cachedMeshFile =>
      val meshFormat = cachedMeshFile.reader.string().getAttr("/", "mesh_format")
      val data =
        cachedMeshFile.reader
          .uint8()
          .readArrayBlockWithOffset("neuroglancer",
                                    meshChunkDataRequest.fragmentSize,
                                    meshChunkDataRequest.fragmentStartOffset)
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

  private def safeExecuteBox[T](filePath: Path)(block: CachedHdf5File => T): Box[T] =
    for {
      _ <- if (filePath.toFile.exists()) {
        Full(true)
      } else {
        Empty ~> "mesh.file.open.failed"
      }
      result <- Using(meshFileCache.withCache(filePath)(CachedHdf5File.fromPath)) {
        block
      }.toOption
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
