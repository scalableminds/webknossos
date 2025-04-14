package com.scalableminds.webknossos.datastore.services.mesh

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{ByteUtils, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.services.Hdf5HashedArrayUtils
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Full}
import org.apache.commons.io.FilenameUtils
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Json, OFormat}

import java.io.ByteArrayInputStream
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ListMeshChunksRequest(
    meshFile: String,
    meshFilePath: Option[String],
    meshFileType: Option[String],
    segmentId: Long
)

object ListMeshChunksRequest {
  implicit val jsonFormat: OFormat[ListMeshChunksRequest] = Json.format[ListMeshChunksRequest]
}

case class MeshChunkDataRequest(
    byteOffset: Long,
    byteSize: Int,
    segmentId: Option[Long] // Only relevant for neuroglancer precomputed meshes, needed because of sharding
)

case class MeshChunkDataRequestList(
    meshFile: String,
    meshFilePath: Option[String],
    meshFileType: Option[String],
    requests: Seq[MeshChunkDataRequest]
)

object MeshChunkDataRequest {
  implicit val jsonFormat: OFormat[MeshChunkDataRequest] = Json.format[MeshChunkDataRequest]
}

object MeshChunkDataRequestList {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestList] = Json.format[MeshChunkDataRequestList]
}

case class MeshFileInfo(
    meshFileName: String,
    meshFilePath: Option[String],
    meshFileType: Option[String],
    mappingName: Option[String],
    formatVersion: Long
)

object MeshFileInfo {
  implicit val jsonFormat: OFormat[MeshFileInfo] = Json.format[MeshFileInfo]
}

case class NeuroglancerSegmentManifest(chunkShape: Vec3Float,
                                       gridOrigin: Vec3Float,
                                       numLods: Int,
                                       lodScales: Array[Float],
                                       vertexOffsets: Array[Vec3Float],
                                       numChunksPerLod: Array[Int],
                                       chunkPositions: List[List[Vec3Int]],
                                       chunkByteSizes: List[List[Long]])

object NeuroglancerSegmentManifest {
  def fromBytes(manifestBytes: Array[Byte]): NeuroglancerSegmentManifest = {
    // All Ints here should be UInt32 per spec. We assume that the sign bit is not necessary (the encoded values are at most 2^31).
    // But they all are used to index into Arrays and JVM doesn't allow for Long Array Indexes,
    // we can't convert them.
    val byteInput = new ByteArrayInputStream(manifestBytes)
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

    val numChunksPerLod = new Array[Int](numLods)
    for (lod <- 0 until numLods) {
      numChunksPerLod(lod) = dis.readInt()
    }

    val chunkPositionsList = new ListBuffer[List[Vec3Int]]
    val chunkSizes = new ListBuffer[List[Long]]
    for (lod <- 0 until numLods) {
      val currentChunkPositions = (ListBuffer[Int](), ListBuffer[Int](), ListBuffer[Int]())
      for (row <- 0 until 3; _ <- 0 until numChunksPerLod(lod)) {
        row match {
          case 0 => currentChunkPositions._1.append(dis.readInt)
          case 1 => currentChunkPositions._2.append(dis.readInt)
          case 2 => currentChunkPositions._3.append(dis.readInt)
        }
      }

      chunkPositionsList.append(
        currentChunkPositions._1
          .lazyZip(currentChunkPositions._2)
          .lazyZip(currentChunkPositions._3)
          .map(Vec3Int(_, _, _))
          .toList)

      val currentChunkSizes = ListBuffer[Long]()
      for (_ <- 0 until numChunksPerLod(lod)) {
        currentChunkSizes.append(dis.readInt.toLong) // Converting to long for convenient + safe summing later
      }
      chunkSizes.append(currentChunkSizes.toList)
    }

    NeuroglancerSegmentManifest(chunkShape,
                                gridOrigin,
                                numLods,
                                lodScales,
                                vertexOffsets,
                                numChunksPerLod,
                                chunkPositionsList.toList,
                                chunkSizes.toList)
  }
}

case class MeshChunk(position: Vec3Float, byteOffset: Long, byteSize: Int, unmappedSegmentId: Option[Long] = None)

object MeshChunk {
  implicit val jsonFormat: OFormat[MeshChunk] = Json.format[MeshChunk]
}
case class MeshLodInfo(scale: Int,
                       vertexOffset: Vec3Float,
                       chunkShape: Vec3Float,
                       chunks: List[MeshChunk],
                       transform: Array[Array[Double]])

object MeshLodInfo {
  implicit val jsonFormat: OFormat[MeshLodInfo] = Json.format[MeshLodInfo]
}
case class MeshSegmentInfo(chunkShape: Vec3Float, gridOrigin: Vec3Float, lods: List[MeshLodInfo])

object MeshSegmentInfo {
  implicit val jsonFormat: OFormat[MeshSegmentInfo] = Json.format[MeshSegmentInfo]
}
case class WebknossosSegmentInfo(
    transform: Array[Array[Double]], // always set to identity
    meshFormat: String,
    chunks: MeshSegmentInfo,
    chunkScale: Array[Double] = Array(1.0, 1.0, 1.0) // Used for Neuroglancer Precomputed Meshes to account for vertex quantization
)

object WebknossosSegmentInfo {
  implicit val jsonFormat: OFormat[WebknossosSegmentInfo] = Json.format[WebknossosSegmentInfo]

  def fromMeshInfosAndMetadata(chunkInfos: List[MeshSegmentInfo],
                               encoding: String,
                               transform: Array[Array[Double]] = Array(Array(1.0, 0.0, 0.0, 0.0),
                                                                       Array(0.0, 1.0, 0.0, 0.0),
                                                                       Array(0.0, 0.0, 1.0, 0.0),
                                                                       Array(0.0, 0.0, 0.0, 1.0)),
                               chunkScale: Array[Double] = Array(1.0, 1.0, 1.0)): Option[WebknossosSegmentInfo] =
    chunkInfos.headOption.flatMap { firstChunkInfo =>
      tryo {
        WebknossosSegmentInfo(
          transform,
          meshFormat = encoding,
          chunks = firstChunkInfo.copy(lods = chunkInfos.map(_.lods).transpose.map(mergeLod)),
          chunkScale = chunkScale
        )
      }
    }

  private def mergeLod(thisLodFromAllChunks: List[MeshLodInfo]): MeshLodInfo = {
    val first = thisLodFromAllChunks.head
    first.copy(chunks = thisLodFromAllChunks.flatMap(_.chunks))
  }

}

class MeshFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Hdf5HashedArrayUtils
    with ByteUtils
    with NeuroglancerMeshHelper {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val meshesDir = "meshes"

  private lazy val meshFileCache = new Hdf5FileCache(30)

  def exploreMeshFiles(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String): Fox[Set[MeshFileInfo]] = {
    val layerDir = dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName).resolve(dataLayerName)
    val meshFileNames = PathUtils
      .listFiles(layerDir.resolve(meshesDir), silent = true, PathUtils.fileExtensionFilter(hdf5FileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)

    val meshFileVersions = meshFileNames.map { fileName =>
      val meshFilePath = layerDir.resolve(meshesDir).resolve(s"$fileName.$hdf5FileExtension")
      versionForMeshFile(meshFilePath)
    }

    val mappingNameFoxes = meshFileNames.lazyZip(meshFileVersions).map { (fileName, fileVersion) =>
      val meshFilePath = layerDir.resolve(meshesDir).resolve(s"$fileName.$hdf5FileExtension")
      mappingNameForMeshFile(meshFilePath, fileVersion)
    }

    for {
      mappingNameBoxes: Seq[Box[String]] <- Fox.sequence(mappingNameFoxes)

      mappingNameOptions = mappingNameBoxes.map(_.toOption)
      zipped = meshFileNames.lazyZip(mappingNameOptions).lazyZip(meshFileVersions)
    } yield
      zipped
        .map({
          case (fileName, mappingName, fileVersion) =>
            MeshFileInfo(fileName, None, Some("local"), mappingName, fileVersion)
        })
        .toSet
  }

  /*
   Note that null is a valid value here for once. Meshfiles with no information about the
   meshFilePath will return Fox.empty, while meshfiles with one marked as empty, will return Fox.successful(null)
   */
  private def mappingNameForMeshFile(meshFilePath: Path, meshFileVersion: Long): Fox[String] = {
    val attributeName = if (meshFileVersion == 0) "metadata/mapping_name" else "mapping_name"
    meshFileCache.withCachedHdf5(meshFilePath) { cachedMeshFile =>
      cachedMeshFile.stringReader.getAttr("/", attributeName)
    } ?~> "mesh.file.readEncoding.failed"
  }

  // Same as above but this variant constructs the meshFilePath itself and converts null to None
  def mappingNameForMeshFile(organizationId: String,
                             datasetDirectoryName: String,
                             dataLayerName: String,
                             meshFileName: String): Option[String] = {
    val meshFilePath =
      dataBaseDir
        .resolve(organizationId)
        .resolve(datasetDirectoryName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"$meshFileName.$hdf5FileExtension")
    meshFileCache
      .withCachedHdf5(meshFilePath) { cachedMeshFile =>
        cachedMeshFile.stringReader.getAttr("/", "mapping_name")
      }
      .toOption
      .flatMap { value =>
        Option(value) // catch null
      }
  }

  private def versionForMeshFile(meshFilePath: Path): Long =
    meshFileCache
      .withCachedHdf5(meshFilePath) { cachedMeshFile =>
        cachedMeshFile.int64Reader.getAttr("/", "artifact_schema_version")
      }
      .toOption
      .getOrElse(0)

  def listMeshChunksForSegmentsMerged(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      meshFileName: String,
      segmentIds: List[Long])(implicit m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    for {
      _ <- Fox.successful(())
      meshFilePath: Path = dataBaseDir
        .resolve(organizationId)
        .resolve(datasetDirectoryName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"$meshFileName.$hdf5FileExtension")
      (encoding, lodScaleMultiplier, transform) <- readMeshfileMetadata(meshFilePath).toFox
      meshChunksForUnmappedSegments: List[MeshSegmentInfo] = listMeshChunksForSegments(meshFilePath,
                                                                                       segmentIds,
                                                                                       lodScaleMultiplier,
                                                                                       transform)
      _ <- bool2Fox(meshChunksForUnmappedSegments.nonEmpty) ?~> "zero chunks" ?~> Messages(
        "mesh.file.listChunks.failed",
        segmentIds.mkString(","),
        meshFileName)
      wkChunkInfos <- WebknossosSegmentInfo.fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, encoding)
    } yield wkChunkInfos

  private def listMeshChunksForSegments(meshFilePath: Path,
                                        segmentIds: List[Long],
                                        lodScaleMultiplier: Double,
                                        transform: Array[Array[Double]]): List[MeshSegmentInfo] =
    meshFileCache
      .withCachedHdf5(meshFilePath) { cachedMeshFile: CachedHdf5File =>
        segmentIds.flatMap(segmentId =>
          listMeshChunksForSegment(cachedMeshFile, segmentId, lodScaleMultiplier, transform))
      }
      .toOption
      .getOrElse(List.empty)

  private def readMeshfileMetadata(meshFilePath: Path): Box[(String, Double, Array[Array[Double]])] =
    meshFileCache.withCachedHdf5(meshFilePath) { cachedMeshFile =>
      val encoding = cachedMeshFile.meshFormat
      val lodScaleMultiplier = cachedMeshFile.float64Reader.getAttr("/", "lod_scale_multiplier")
      val transform = cachedMeshFile.float64Reader.getMatrixAttr("/", "transform")
      (encoding, lodScaleMultiplier, transform)
    }

  private def listMeshChunksForSegment(cachedMeshFile: CachedHdf5File,
                                       segmentId: Long,
                                       lodScaleMultiplier: Double,
                                       transform: Array[Array[Double]]): Box[MeshSegmentInfo] =
    tryo {
      val (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) =
        getNeuroglancerSegmentManifestOffsets(segmentId, cachedMeshFile)

      val manifestBytes = cachedMeshFile.uint8Reader.readArrayBlockWithOffset(
        "/neuroglancer",
        (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt,
        neuroglancerSegmentManifestStart)
      val segmentManifest = NeuroglancerSegmentManifest.fromBytes(manifestBytes)
      enrichSegmentInfo(segmentManifest, lodScaleMultiplier, transform, neuroglancerSegmentManifestStart, segmentId)
    }

  override def computeGlobalPosition(segmentInfo: NeuroglancerSegmentManifest,
                                     lod: Int,
                                     lodScaleMultiplier: Double,
                                     currentChunk: Int): Vec3Float =
    segmentInfo.gridOrigin + segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float * segmentInfo.chunkShape * Math
      .pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

  override def getLodTransform(segmentInfo: NeuroglancerSegmentManifest,
                               lodScaleMultiplier: Double,
                               transform: Array[Array[Double]],
                               lod: Int): Array[Array[Double]] = transform

  private def getNeuroglancerSegmentManifestOffsets(segmentId: Long, cachedMeshFile: CachedHdf5File): (Long, Long) = {
    val bucketIndex = cachedMeshFile.hashFunction(segmentId) % cachedMeshFile.nBuckets
    val bucketOffsets = cachedMeshFile.uint64Reader.readArrayBlockWithOffset("bucket_offsets", 2, bucketIndex)
    val bucketStart = bucketOffsets(0)
    val bucketEnd = bucketOffsets(1)

    if (bucketEnd - bucketStart == 0) throw new Exception(s"No entry for segment $segmentId")

    val buckets = cachedMeshFile.uint64Reader.readMatrixBlockWithOffset("buckets",
                                                                        (bucketEnd - bucketStart + 1).toInt,
                                                                        3,
                                                                        bucketStart,
                                                                        0)

    val bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
    if (bucketLocalOffset < 0) throw new Exception(s"SegmentId $segmentId not in bucket list")
    val neuroglancerStart = buckets(bucketLocalOffset)(1)
    val neuroglancerEnd = buckets(bucketLocalOffset)(2)

    (neuroglancerStart, neuroglancerEnd)
  }

  def readMeshChunk(organizationId: String,
                    datasetDirectoryName: String,
                    dataLayerName: String,
                    meshChunkDataRequests: MeshChunkDataRequestList,
  ): Box[(Array[Byte], String)] = {
    val meshFilePath = dataBaseDir
      .resolve(organizationId)
      .resolve(datasetDirectoryName)
      .resolve(dataLayerName)
      .resolve(meshesDir)
      .resolve(s"${meshChunkDataRequests.meshFile}.$hdf5FileExtension")
    for {
      resultBox <- meshFileCache.withCachedHdf5(meshFilePath) { cachedMeshFile =>
        readMeshChunkFromCachedMeshfile(cachedMeshFile, meshChunkDataRequests)
      }
      (output, encoding) <- resultBox
    } yield (output, encoding)
  }

  private def readMeshChunkFromCachedMeshfile(
      cachedMeshFile: CachedHdf5File,
      meshChunkDataRequests: MeshChunkDataRequestList): Box[(Array[Byte], String)] = {
    val meshFormat = cachedMeshFile.meshFormat
    // Sort the requests by byte offset to optimize for spinning disk access
    val requestsReordered =
      meshChunkDataRequests.requests.zipWithIndex.sortBy(requestAndIndex => requestAndIndex._1.byteOffset).toList
    val data: List[(Array[Byte], Int)] = requestsReordered.map { requestAndIndex =>
      val meshChunkDataRequest = requestAndIndex._1
      val data =
        cachedMeshFile.uint8Reader.readArrayBlockWithOffset("neuroglancer",
                                                            meshChunkDataRequest.byteSize,
                                                            meshChunkDataRequest.byteOffset)
      (data, requestAndIndex._2)
    }
    val dataSorted = data.sortBy(d => d._2)
    Full((dataSorted.flatMap(d => d._1).toArray, meshFormat))
  }

  def clearCache(organizationId: String, datasetDirectoryName: String, layerNameOpt: Option[String]): Int = {
    val datasetPath = dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName)
    val relevantPath = layerNameOpt.map(l => datasetPath.resolve(l)).getOrElse(datasetPath)
    meshFileCache.clear(key => key.startsWith(relevantPath.toString))
  }

}
