package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  LayerAttachment,
  LayerAttachmentDataformat
}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ListMeshChunksRequest(
    meshFileName: String,
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
    meshFileName: String,
    requests: Seq[MeshChunkDataRequest]
)

object MeshChunkDataRequest {
  implicit val jsonFormat: OFormat[MeshChunkDataRequest] = Json.format[MeshChunkDataRequest]
}

object MeshChunkDataRequestList {
  implicit val jsonFormat: OFormat[MeshChunkDataRequestList] = Json.format[MeshChunkDataRequestList]
}

case class MeshFileKey(dataSourceId: DataSourceId, layerName: String, attachment: LayerAttachment)

// Sent to wk frontend
case class MeshFileInfo(
    name: String,
    mappingName: Option[String],
    formatVersion: Long
)

object MeshFileInfo {
  implicit val jsonFormat: OFormat[MeshFileInfo] = Json.format[MeshFileInfo]
}

class MeshFileService @Inject()(hdf5MeshFileService: Hdf5MeshFileService,
                                zarrMeshFileService: ZarrMeshFileService,
                                neuroglancerPrecomputedMeshService: NeuroglancerPrecomputedMeshFileService)
    extends FoxImplicits {

  private val meshFileKeyCache
    : AlfuCache[(DataSourceId, String, String), MeshFileKey] = AlfuCache() // dataSourceId, layerName, meshFileName → MeshFileKey

  def lookUpMeshFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer, meshFileName: String)(
      implicit ec: ExecutionContext): Fox[MeshFileKey] =
    meshFileKeyCache.getOrLoad((dataSourceId, dataLayer.name, meshFileName),
                               _ => lookUpMeshFileKeyImpl(dataSourceId, dataLayer, meshFileName).toFox)

  private def lookUpMeshFileKeyImpl(dataSourceId: DataSourceId,
                                    dataLayer: DataLayer,
                                    meshFileName: String): Option[MeshFileKey] =
    for {
      registeredAttachment <- dataLayer.attachments match {
        case Some(attachments) => attachments.meshes.find(_.name == meshFileName)
        case None              => None
      }
    } yield
      MeshFileKey(
        dataSourceId,
        dataLayer.name,
        registeredAttachment
      )

  def listMeshFiles(dataSourceId: DataSourceId, dataLayer: DataLayer)(implicit ec: ExecutionContext,
                                                                      tc: TokenContext,
                                                                      m: MessagesProvider): Fox[Seq[MeshFileInfo]] = {
    val meshFileNames = dataLayer.attachments.map(_.meshes).getOrElse(Seq.empty).map(_.name)

    Fox.fromFuture(
      Fox
        .serialSequence(meshFileNames) { meshFileName =>
          for {
            meshFileKey <- lookUpMeshFileKey(dataSourceId, dataLayer, meshFileName) ?~> Messages(
              "mesh.file.lookup.failed",
              meshFileName)
            formatVersion <- versionForMeshFile(meshFileKey) ?~> Messages("mesh.file.readVersion.failed", meshFileName)
            mappingName <- mappingNameForMeshFile(meshFileKey) ?~> Messages("mesh.file.readMappingName.failed",
                                                                            meshFileName)
          } yield MeshFileInfo(meshFileName, mappingName, formatVersion)
        }
        // Only return successes, we don’t want a malformed file breaking the list request.
        .map(_.flatten))
  }

  // Same as above but this variant constructs the meshFilePath itself and converts null to None
  def mappingNameForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                       tc: TokenContext): Fox[Option[String]] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.mappingNameForMeshFile(meshFileKey)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5MeshFileService.mappingNameForMeshFile(meshFileKey).toFox
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        Fox.successful(None)
      case _ => unsupportedDataFormat(meshFileKey)
    }

  private def versionForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.versionForMeshFile(meshFileKey)
      case LayerAttachmentDataformat.hdf5 =>
        Fox.successful(hdf5MeshFileService.versionForMeshFile(meshFileKey))
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        Fox.successful(NeuroglancerMesh.meshInfoVersion)
      case _ => unsupportedDataFormat(meshFileKey)
    }

  def getVertexQuantizationBits(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Int] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        neuroglancerPrecomputedMeshService.getVertexQuantizationBits(meshFileKey)
      case _ => Fox.successful(0)
    }

  def listMeshChunksForSegmentsMerged(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.listMeshChunksForMultipleSegments(meshFileKey, segmentIds)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5MeshFileService.listMeshChunksForMultipleSegments(meshFileKey, segmentIds)
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        neuroglancerPrecomputedMeshService.listMeshChunksForMultipleSegments(meshFileKey, segmentIds)
      case _ => unsupportedDataFormat(meshFileKey)
    }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest],
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Array[Byte], String)] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrMeshFileService.readMeshChunk(meshFileKey, meshChunkDataRequests)
      case LayerAttachmentDataformat.hdf5  => hdf5MeshFileService.readMeshChunk(meshFileKey, meshChunkDataRequests).toFox
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        neuroglancerPrecomputedMeshService.readMeshChunk(meshFileKey, meshChunkDataRequests)
      case _ => unsupportedDataFormat(meshFileKey)
    }

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    meshFileKeyCache.clear {
      case (keyDataSourceId, keyLayerName, _) =>
        dataSourceId == keyDataSourceId && layerNameOpt.forall(_ == keyLayerName)
    }

    val clearedHdf5Count = hdf5MeshFileService.clearCache(dataSourceId, layerNameOpt)

    val clearedZarrCount = zarrMeshFileService.clearCache(dataSourceId, layerNameOpt)

    val clearedNeuroglancerCount = neuroglancerPrecomputedMeshService.clearCache(dataSourceId, layerNameOpt)

    clearedHdf5Count + clearedZarrCount + clearedNeuroglancerCount
  }

  private def unsupportedDataFormat(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext) =
    Fox.failure(s"Trying to load mesh file with unsupported data format ${meshFileKey.attachment.dataFormat}")
}
