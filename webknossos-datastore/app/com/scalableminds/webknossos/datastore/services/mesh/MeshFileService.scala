package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.enumeration.ExtendedEnumeration
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
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.Box
import org.apache.commons.io.FilenameUtils
import play.api.i18n.MessagesProvider
import play.api.libs.json.{Format, JsResult, JsString, JsValue, Json, OFormat}

import java.net.URI
import java.nio.file.Paths
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
    meshFileName: String,
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
    with ByteUtils {

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

  // Same as above but this variant constructs the meshFilePath itself and converts null to None
  def mappingNameForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[String] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.mappingNameForMeshFile(meshFileKey)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5MeshFileService.mappingNameForMeshFile(meshFileKey).toFox
    }

  def listMeshChunksForSegmentsMerged(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.neuroglancerPrecomputed =>
        neuroglancerPrecomputedMeshService.listMeshChunksForMultipleSegments(meshFileKey, segmentIds)
      case LayerAttachmentDataformat.zarr3 =>
        zarrMeshFileService.listMeshChunksForMultipleSegments(meshFileKey, segmentIds)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5MeshFileService.listMeshChunksForMultipleSegments(meshFileKey, segmentIds)
    }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest],
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Array[Byte], String)] =
    meshFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.hdf5  => hdf5MeshFileService.readMeshChunk(meshFileKey, meshChunkDataRequests).toFox
      case LayerAttachmentDataformat.zarr3 => zarrMeshFileService.readMeshChunk(meshFileKey, meshChunkDataRequests)
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
