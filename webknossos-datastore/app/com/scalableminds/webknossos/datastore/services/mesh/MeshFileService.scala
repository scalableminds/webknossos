package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{ByteUtils, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  LayerAttachment,
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.services.Hdf5HashedArrayUtils
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache, RemoteSourceDescriptorService}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Full}
import org.apache.commons.io.FilenameUtils
import org.checkerframework.checker.units.qual.m
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Format, JsResult, JsString, JsValue, Json, OFormat}

import java.net.URI
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

case class ListMeshChunksRequest(
    meshFile: MeshFileInfo,
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
    meshFile: MeshFileInfo,
    requests: Seq[MeshChunkDataRequest]
)

object MeshChunkDataRequest {
  implicit val jsonFormat: OFormat[MeshChunkDataRequest] = Json.format[MeshChunkDataRequest]
}

object MeshChunkDataRequestList {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestList] = Json.format[MeshChunkDataRequestList]
}

// TODO should this become a generic AttachmentKey?
case class MeshFileKey(dataSourceId: DataSourceId, layerName: String, attachment: LayerAttachment)

object MeshFileType extends ExtendedEnumeration {
  type MeshFileType = Value
  val local, neuroglancerPrecomputed = Value

  implicit object MeshFileTypeFormat extends Format[MeshFileType] {
    def reads(json: JsValue): JsResult[MeshFileType] =
      json.validate[String].map(MeshFileType.withName)

    def writes(meshFileType: MeshFileType): JsValue = JsString(meshFileType.toString)
  }
}

case class MeshFileInfo(
    name: String,
    path: Option[String],
    fileType: Option[MeshFileType.MeshFileType],
    mappingName: Option[String],
    formatVersion: Long
) {
  def isNeuroglancerPrecomputed: Boolean =
    fileType.contains(MeshFileType.neuroglancerPrecomputed)
}

object MeshFileInfo {
  implicit val jsonFormat: OFormat[MeshFileInfo] = Json.format[MeshFileInfo]
}

class MeshFileService @Inject()(
    config: DataStoreConfig,
    hdf5MeshFileService: Hdf5MeshFileService,
    zarrMeshFileService: ZarrMeshFileService,
    neuroglancerPrecomputedMeshService: NeuroglancerPrecomputedMeshFileService,
    remoteSourceDescriptorService: RemoteSourceDescriptorService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with Hdf5HashedArrayUtils
    with ByteUtils
    with NeuroglancerMeshHelper {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val meshesDir = "meshes"

  private val meshFileKeyCache
    : AlfuCache[(DataSourceId, String, String), MeshFileKey] = AlfuCache() // dataSourceId, layerName, mappingName → MeshFileKey

  def lookUpMeshFile(dataSourceId: DataSourceId, dataLayer: DataLayer, meshFileName: String)(
      implicit ec: ExecutionContext): Fox[MeshFileKey] =
    meshFileKeyCache.getOrLoad((dataSourceId, dataLayer.name, meshFileName),
                               _ => lookUpMeshFileImpl(dataSourceId, dataLayer, meshFileName).toFox)

  private def lookUpMeshFileImpl(dataSourceId: DataSourceId,
                                 dataLayer: DataLayer,
                                 meshFileName: String): Box[MeshFileKey] = {
    val registeredAttachment: Option[LayerAttachment] = dataLayer.attachments match {
      case Some(attachments) => attachments.meshes.find(_.name == meshFileName)
      case None              => None
    }
    val localDatsetDir = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    for {
      registeredAttachmentNormalized <- tryo(registeredAttachment.map { attachment =>
        attachment.copy(
          path =
            remoteSourceDescriptorService.uriFromPathLiteral(attachment.path.toString, localDatsetDir, dataLayer.name))
      })
    } yield
      MeshFileKey(
        dataSourceId,
        dataLayer.name,
        registeredAttachmentNormalized.getOrElse(
          LayerAttachment(
            meshFileName,
            new URI(dataBaseDir.resolve(dataLayer.name).resolve(meshesDir).toString),
            LayerAttachmentDataformat.hdf5
          )
        )
      )
  }

  def exploreMeshFiles(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String): Future[Set[MeshFileInfo]] = {
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
            MeshFileInfo(fileName, None, Some(MeshFileType.local), mappingName, fileVersion)
        })
        .toSet
  }

  /*
   Note that null is a valid value here for once. Meshfiles with no information about the
   meshFilePath will return Fox.empty, while meshfiles with one marked as empty, will return Fox.successful(null)
   */
  private def mappingNameForMeshFile(meshFilePath: Path, meshFileVersion: Long): Fox[String] = {
    val attributeName = if (meshFileVersion == 0) "metadata/mapping_name" else "mapping_name"
    meshFileCache
      .withCachedHdf5(meshFilePath) { cachedMeshFile =>
        cachedMeshFile.stringReader.getAttr("/", attributeName)
      }
      .toFox ?~> "mesh.file.readEncoding.failed"
  }

  // Same as above but this variant constructs the meshFilePath itself and converts null to None
  def mappingNameForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[String] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.mappingNameForMeshFile(meshFileKey)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5MeshFileService.mappingNameForMeshFile(meshFileKey).toFox
    }

  private def versionForMeshFile(meshFilePath: Path): Long =
    meshFileCache
      .withCachedHdf5(meshFilePath) { cachedMeshFile =>
        cachedMeshFile.int64Reader.getAttr("/", "artifact_schema_version")
      }
      .toOption
      .getOrElse(0)

  def listMeshChunksForSegmentsMerged(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        neuroglancerPrecomputedMeshService.listMeshChunksForMultipleSegments(meshFileKey, segmentIds)
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.listMeshChunksForMultipleSegments()
      case LayerAttachmentDataformat.hdf5 =>
        hdf5MeshFileService.listMeshChunksForMultipleSegments()
    }

  // TODO move to hdf5 meshfile service
  for {
    _ <- Fox.successful(())
    meshFilePath: Path = dataBaseDir
      .resolve(organizationId)
      .resolve(datasetDirectoryName)
      .resolve(dataLayerName)
      .resolve(meshesDir)
      .resolve(s"$meshFileName.$hdf5FileExtension")
    (encoding, lodScaleMultiplier, transform) <- readMeshfileMetadata(meshFilePath).toFox
    meshChunksForUnmappedSegments: List[List[MeshLodInfo]] = listMeshChunksForSegments(meshFilePath,
                                                                                       segmentIds,
                                                                                       lodScaleMultiplier,
                                                                                       transform)
    _ <- Fox.fromBool(meshChunksForUnmappedSegments.nonEmpty) ?~> "zero chunks" ?~> Messages(
      "mesh.file.listChunks.failed",
      segmentIds.mkString(","),
      meshFileName)
    wkChunkInfos <- WebknossosSegmentInfo.fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, encoding).toFox
  } yield wkChunkInfos

  private def listMeshChunksForSegments(meshFilePath: Path,
                                        segmentIds: Seq[Long],
                                        lodScaleMultiplier: Double,
                                        transform: Array[Array[Double]]): List[List[MeshLodInfo]] =
    meshFileCache
      .withCachedHdf5(meshFilePath) { cachedMeshFile: CachedHdf5File =>
        segmentIds.toList.flatMap(segmentId =>
          listMeshChunksForSegment(cachedMeshFile, segmentId, lodScaleMultiplier, transform))
      }
      .toOption
      .getOrElse(List.empty)

  private def listMeshChunksForSegment(cachedMeshFile: CachedHdf5File,
                                       segmentId: Long,
                                       lodScaleMultiplier: Double,
                                       transform: Array[Array[Double]]): Box[List[MeshLodInfo]] =
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
      .resolve(s"${meshChunkDataRequests.meshFile.name}.$hdf5FileExtension")
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
