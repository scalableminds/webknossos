package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  LayerAttachment,
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.services.Hdf5HashedArrayUtils
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import net.liftweb.common.Box.tryo
import net.liftweb.common.Box
import org.apache.commons.io.FilenameUtils
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Json, OFormat}

import java.nio.file.Paths
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

class MeshFileService @Inject()(config: DataStoreConfig,
                                hdf5MeshFileService: Hdf5MeshFileService,
                                zarrMeshFileService: ZarrMeshFileService,
                                neuroglancerPrecomputedMeshService: NeuroglancerPrecomputedMeshFileService,
                                remoteSourceDescriptorService: RemoteSourceDescriptorService)
    extends FoxImplicits
    with Hdf5HashedArrayUtils {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val localMeshesDir = "meshes"

  private val meshFileKeyCache
    : AlfuCache[(DataSourceId, String, String), MeshFileKey] = AlfuCache() // dataSourceId, layerName, mappingName → MeshFileKey

  def lookUpMeshFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer, meshFileName: String)(
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
    val localDatasetDir = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    for {
      registeredAttachmentNormalized <- tryo(registeredAttachment.map { attachment =>
        attachment.copy(
          path =
            remoteSourceDescriptorService.uriFromPathLiteral(attachment.path.toString, localDatasetDir, dataLayer.name))
      })
    } yield
      MeshFileKey(
        dataSourceId,
        dataLayer.name,
        registeredAttachmentNormalized.getOrElse(
          LayerAttachment(
            meshFileName,
            localDatasetDir.resolve(dataLayer.name).resolve(localMeshesDir).toUri,
            LayerAttachmentDataformat.hdf5
          )
        )
      )
  }

  def listMeshFiles(dataSourceId: DataSourceId, dataLayer: DataLayer)(implicit ec: ExecutionContext,
                                                                      tc: TokenContext,
                                                                      m: MessagesProvider): Fox[Seq[MeshFileInfo]] = {
    val attachedMeshFileNames = dataLayer.attachments.map(_.meshes).getOrElse(Seq.empty).map(_.name).toSet

    val layerDir =
      dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName).resolve(dataLayer.name)
    val scannedMeshFileNames = PathUtils
      .listFiles(layerDir.resolve(localMeshesDir), silent = true, PathUtils.fileExtensionFilter(hdf5FileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet

    val allMeshFileNames = attachedMeshFileNames ++ scannedMeshFileNames

    Fox.fromFuture(
      Fox
        .serialSequence(allMeshFileNames.toSeq) { meshFileName =>
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
    }

  private def versionForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.versionForMeshFile(meshFileKey)
      case LayerAttachmentDataformat.hdf5 =>
        Fox.successful(hdf5MeshFileService.versionForMeshFile(meshFileKey))
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        Fox.successful(NeuroglancerMesh.meshInfoVersion)
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
    }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest],
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Array[Byte], String)] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrMeshFileService.readMeshChunk(meshFileKey, meshChunkDataRequests)
      case LayerAttachmentDataformat.hdf5  => hdf5MeshFileService.readMeshChunk(meshFileKey, meshChunkDataRequests).toFox
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        neuroglancerPrecomputedMeshService.readMeshChunk(meshFileKey, meshChunkDataRequests)
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

}
