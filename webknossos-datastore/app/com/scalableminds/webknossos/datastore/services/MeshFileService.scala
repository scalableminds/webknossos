package com.scalableminds.webknossos.datastore.services

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{ByteUtils, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.CachedHdf5Utils.executeWithCachedHdf5
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Json, OFormat}

import java.io.ByteArrayInputStream
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters.ListHasAsScala

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

case class MeshChunkDataRequestV3(
    byteOffset: Long,
    byteSize: Int
)

case class MeshChunkDataRequestV3List(
    meshFile: String,
    requests: Seq[MeshChunkDataRequestV3]
)

object MeshChunkDataRequestV0 {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestV0] = Json.format[MeshChunkDataRequestV0]
}

object MeshChunkDataRequestV3 {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestV3] = Json.format[MeshChunkDataRequestV3]
}

object MeshChunkDataRequestV3List {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestV3List] = Json.format[MeshChunkDataRequestV3List]
}

case class MeshFileInfo(
    meshFileName: String,
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

case class MeshChunk(position: Vec3Float, byteOffset: Long, byteSize: Int)

object MeshChunk {
  implicit val jsonFormat: OFormat[MeshChunk] = Json.format[MeshChunk]
}
case class MeshLodInfo(scale: Int, vertexOffset: Vec3Float, chunkShape: Vec3Float, chunks: List[MeshChunk])

object MeshLodInfo {
  implicit val jsonFormat: OFormat[MeshLodInfo] = Json.format[MeshLodInfo]
}
case class MeshSegmentInfo(chunkShape: Vec3Float, gridOrigin: Vec3Float, lods: List[MeshLodInfo])

object MeshSegmentInfo {
  implicit val jsonFormat: OFormat[MeshSegmentInfo] = Json.format[MeshSegmentInfo]
}
case class WebknossosSegmentInfo(transform: Array[Array[Double]], meshFormat: String, chunks: MeshSegmentInfo) {
  def merge(that: WebknossosSegmentInfo): WebknossosSegmentInfo =
    // assume that transform, meshFormat, chunkShape, gridOrigin, scale and vertexOffset are the same
    WebknossosSegmentInfo(
      transform,
      meshFormat,
      chunks = MeshSegmentInfo(
        chunks.chunkShape,
        chunks.gridOrigin,
        lods = chunks.lods
          .lazyZip(that.chunks.lods)
          .map((lod1, lod2) => MeshLodInfo(lod1.scale, lod1.vertexOffset, lod1.chunkShape, lod1.chunks ::: lod2.chunks))
      )
    )
}

object WebknossosSegmentInfo {
  implicit val jsonFormat: OFormat[WebknossosSegmentInfo] = Json.format[WebknossosSegmentInfo]
}

class MeshFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Hdf5HashedArrayUtils
    with ByteUtils {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val meshesDir = "meshes"
  private val defaultLevelOfDetail = 0

  private lazy val meshFileCache = new Hdf5FileCache(30)

  def exploreMeshFiles(organizationName: String, datasetName: String, dataLayerName: String): Fox[Set[MeshFileInfo]] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(datasetName).resolve(dataLayerName)
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
    } yield zipped.map(MeshFileInfo(_, _, _)).toSet
  }

  /*
   Note that null is a valid value here for once. Meshfiles with no information about the
   meshFilePath will return Fox.empty, while meshfiles with one marked as empty, will return Fox.successful(null)
   */
  private def mappingNameForMeshFile(meshFilePath: Path, meshFileVersion: Long): Fox[String] = {
    val attributeName = if (meshFileVersion == 0) "metadata/mapping_name" else "mapping_name"
    executeWithCachedHdf5(meshFilePath, meshFileCache) { cachedMeshFile =>
      cachedMeshFile.reader.string().getAttr("/", attributeName)
    } ?~> "mesh.file.readEncoding.failed"
  }

  // Same as above but this variant constructs the meshFilePath itself and converts null to None
  def mappingNameForMeshFile(organizationName: String,
                             datasetName: String,
                             dataLayerName: String,
                             meshFileName: String): Option[String] = {
    val meshFilePath =
      dataBaseDir
        .resolve(organizationName)
        .resolve(datasetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"$meshFileName.$hdf5FileExtension")
    executeWithCachedHdf5(meshFilePath, meshFileCache) { cachedMeshFile =>
      cachedMeshFile.reader.string().getAttr("/", "mapping_name")
    }.toOption.flatMap { value =>
      Option(value) // catch null
    }
  }

  private def versionForMeshFile(meshFilePath: Path): Long =
    executeWithCachedHdf5(meshFilePath, meshFileCache) { cachedMeshFile =>
      cachedMeshFile.reader.int64().getAttr("/", "artifact_schema_version")
    }.toOption.getOrElse(0)

  def listMeshChunksForSegmentsV3(organizationName: String,
                                  datasetName: String,
                                  dataLayerName: String,
                                  meshFileName: String,
                                  segmentIds: Seq[Long]): Fox[WebknossosSegmentInfo] = {
    val meshChunksForUnmappedSegments = segmentIds.map(segmentId =>
      listMeshChunksForSegmentV3(organizationName, datasetName, dataLayerName, meshFileName, segmentId).toOption)
    val meshChunksForUnmappedSegmentsFlat = meshChunksForUnmappedSegments.flatten
    for {
      _ <- bool2Fox(meshChunksForUnmappedSegmentsFlat.nonEmpty) ?~> "zero chunks" ?~> "mesh.file.listChunks.failed"
      chunkInfos = meshChunksForUnmappedSegmentsFlat.reduce(_.merge(_))
    } yield chunkInfos
  }

  private def listMeshChunksForSegmentV3(organizationName: String,
                                         datasetName: String,
                                         dataLayerName: String,
                                         meshFileName: String,
                                         segmentId: Long): Box[WebknossosSegmentInfo] = {
    val meshFilePath =
      dataBaseDir
        .resolve(organizationName)
        .resolve(datasetName)
        .resolve(dataLayerName)
        .resolve(meshesDir)
        .resolve(s"$meshFileName.$hdf5FileExtension")

    executeWithCachedHdf5(meshFilePath, meshFileCache) { cachedMeshFile =>
      val encoding = cachedMeshFile.reader.string().getAttr("/", "mesh_format")
      val lodScaleMultiplier = cachedMeshFile.reader.float64().getAttr("/", "lod_scale_multiplier")
      val transform = cachedMeshFile.reader.float64().getMatrixAttr("/", "transform")

      val (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) =
        getNeuroglancerSegmentManifestOffsets(segmentId, cachedMeshFile)

      val manifestBytes = cachedMeshFile.reader
        .uint8()
        .readArrayBlockWithOffset("/neuroglancer",
                                  (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt,
                                  neuroglancerSegmentManifestStart)
      val segmentManifest = NeuroglancerSegmentManifest.fromBytes(manifestBytes)
      val enrichedSegmentManifest =
        enrichSegmentInfo(segmentManifest, lodScaleMultiplier, neuroglancerSegmentManifestStart)
      WebknossosSegmentInfo(transform = transform, meshFormat = encoding, chunks = enrichedSegmentManifest)
    }
  }

  private def enrichSegmentInfo(segmentInfo: NeuroglancerSegmentManifest,
                                lodScaleMultiplier: Double,
                                neuroglancerOffsetStart: Long): MeshSegmentInfo = {
    val bytesPerLod = segmentInfo.chunkByteSizes.map(_.sum)
    val totalMeshSize = bytesPerLod.sum
    val meshByteStartOffset = neuroglancerOffsetStart - totalMeshSize
    val chunkByteOffsetsInLod = segmentInfo.chunkByteSizes.map(_.scanLeft(0L)(_ + _)) // builds cumulative sum

    def getChunkByteOffset(lod: Int, currentChunk: Int): Long =
      // get past the finer lods first, then take offset in selected lod
      bytesPerLod.take(lod).sum + chunkByteOffsetsInLod(lod)(currentChunk)

    def computeGlobalPositionAndOffset(lod: Int, currentChunk: Int): MeshChunk = {
      val globalPosition = segmentInfo.gridOrigin + segmentInfo
        .chunkPositions(lod)(currentChunk)
        .toVec3Float * segmentInfo.chunkShape * Math.pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

      MeshChunk(
        position = globalPosition, // This position is in Voxel Space
        byteOffset = meshByteStartOffset + getChunkByteOffset(lod, currentChunk),
        byteSize = segmentInfo.chunkByteSizes(lod)(currentChunk).toInt // size must be int32 to fit in java array
      )
    }

    val lods: Seq[Int] = for (lod <- 0 until segmentInfo.numLods) yield lod

    def chunkCountsWithLod(lod: Int): IndexedSeq[(Int, Int)] =
      for (currentChunk <- 0 until segmentInfo.numChunksPerLod(lod))
        yield (lod, currentChunk)
    val chunks = lods.map(lod => chunkCountsWithLod(lod).map(x => computeGlobalPositionAndOffset(x._1, x._2)).toList)

    val meshfileLods = lods
      .map(
        lod =>
          MeshLodInfo(scale = segmentInfo.lodScales(lod).toInt,
                      vertexOffset = segmentInfo.vertexOffsets(lod),
                      chunkShape = segmentInfo.chunkShape,
                      chunks = chunks(lod)))
      .toList
    MeshSegmentInfo(chunkShape = segmentInfo.chunkShape, gridOrigin = segmentInfo.gridOrigin, lods = meshfileLods)
  }

  private def getNeuroglancerSegmentManifestOffsets(segmentId: Long, cachedMeshFile: CachedHdf5File): (Long, Long) = {
    val nBuckets = cachedMeshFile.reader.uint64().getAttr("/", "n_buckets")
    val hashName = cachedMeshFile.reader.string().getAttr("/", "hash_function")

    val bucketIndex = getHashFunction(hashName)(segmentId) % nBuckets
    val bucketOffsets = cachedMeshFile.reader.uint64().readArrayBlockWithOffset("bucket_offsets", 2, bucketIndex)
    val bucketStart = bucketOffsets(0)
    val bucketEnd = bucketOffsets(1)

    if (bucketEnd - bucketStart == 0) throw new Exception(s"No entry for segment $segmentId")

    val buckets = cachedMeshFile.reader
      .uint64()
      .readMatrixBlockWithOffset("buckets", (bucketEnd - bucketStart + 1).toInt, 3, bucketStart, 0)

    val bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
    if (bucketLocalOffset < 0) throw new Exception(s"SegmentId $segmentId not in bucket list")
    val neuroglancerStart = buckets(bucketLocalOffset)(1)
    val neuroglancerEnd = buckets(bucketLocalOffset)(2)

    (neuroglancerStart, neuroglancerEnd)
  }

  def readMeshChunkV3(organizationName: String,
                      datasetName: String,
                      dataLayerName: String,
                      meshChunkDataRequests: MeshChunkDataRequestV3List,
  ): Fox[(Array[Byte], String)] =
    for {
      // Sort the requests by byte offset to optimize for spinning disk access
      data: List[(Array[Byte], String, Int)] <- Fox.serialCombined(
        meshChunkDataRequests.requests.zipWithIndex.sortBy(requestAndIndex => requestAndIndex._1.byteOffset).toList
      )(requestAndIndex => {
        val meshChunkDataRequest = requestAndIndex._1
        val meshFilePath = dataBaseDir
          .resolve(organizationName)
          .resolve(datasetName)
          .resolve(dataLayerName)
          .resolve(meshesDir)
          .resolve(s"${meshChunkDataRequests.meshFile}.$hdf5FileExtension")

        executeWithCachedHdf5(meshFilePath, meshFileCache) { cachedMeshFile =>
          val meshFormat = cachedMeshFile.reader.string().getAttr("/", "mesh_format")
          val data =
            cachedMeshFile.reader
              .uint8()
              .readArrayBlockWithOffset("neuroglancer", meshChunkDataRequest.byteSize, meshChunkDataRequest.byteOffset)
          (data, meshFormat, requestAndIndex._2)
        } ?~> "mesh.file.readData.failed"
      })
      dataSorted = data.sortBy(d => d._3)
      _ <- Fox.bool2Fox(data.map(d => d._2).toSet.size == 1) ?~> "Different encodings for the same mesh chunk request found."
      encoding <- data.map(d => d._2).headOption
      output = dataSorted.flatMap(d => d._1).toArray
    } yield (output, encoding)

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
