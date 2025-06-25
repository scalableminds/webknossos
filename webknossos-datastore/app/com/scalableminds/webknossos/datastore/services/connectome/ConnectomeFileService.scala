package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  LayerAttachment,
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FilenameUtils
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Json, OFormat}

import java.nio.file.Paths
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ByAgglomerateIdsRequest(
    connectomeFile: String,
    agglomerateIds: List[Long]
)

object ByAgglomerateIdsRequest {
  implicit val jsonFormat: OFormat[ByAgglomerateIdsRequest] = Json.format[ByAgglomerateIdsRequest]
}

case class BySynapseIdsRequest(
    connectomeFile: String,
    synapseIds: List[Long]
)

object BySynapseIdsRequest {
  implicit val jsonFormat: OFormat[BySynapseIdsRequest] = Json.format[BySynapseIdsRequest]
}

case class DirectedSynapseList(
    in: List[Long],
    out: List[Long]
)

object DirectedSynapseList {
  implicit val jsonFormat: OFormat[DirectedSynapseList] = Json.format[DirectedSynapseList]
}

case class DirectedSynapseListMutable(
    in: ListBuffer[Long],
    out: ListBuffer[Long]
) {
  def freeze: DirectedSynapseList = DirectedSynapseList(in.toList, out.toList)
}

object DirectedSynapseListMutable {
  def empty: DirectedSynapseListMutable = DirectedSynapseListMutable(ListBuffer(), ListBuffer())
}

case class SynapseTypesWithLegend(
    synapseTypes: List[Long],
    typeToString: List[String],
)

object SynapseTypesWithLegend {
  implicit val jsonFormat: OFormat[SynapseTypesWithLegend] = Json.format[SynapseTypesWithLegend]
}

case class ConnectomeFileNameWithMappingName(
    connectomeFileName: String,
    mappingName: String
)

object ConnectomeFileNameWithMappingName {
  implicit val jsonFormat: OFormat[ConnectomeFileNameWithMappingName] = Json.format[ConnectomeFileNameWithMappingName]
}

case class ConnectomeLegend(synapse_type_names: List[String])

object ConnectomeLegend {
  implicit val jsonFormat: OFormat[ConnectomeLegend] = Json.format[ConnectomeLegend]
}

case class ConnectomeFileKey(dataSourceId: DataSourceId, layerName: String, attachment: LayerAttachment)

class ConnectomeFileService @Inject()(config: DataStoreConfig,
                                      remoteSourceDescriptorService: RemoteSourceDescriptorService,
                                      hdf5ConnectomeFileService: Hdf5ConnectomeFileService,
                                      zarrConnectomeFileService: ZarrConnectomeFileService)
    extends FoxImplicits
    with LazyLogging {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val localConnectomesDir = "connectomes"
  private val hdf5ConnectomeFileExtension = "hdf5"

  private val connectomeFileKeyCache
    : AlfuCache[(DataSourceId, String, String), ConnectomeFileKey] = AlfuCache() // dataSourceId, layerName, attachmentName → ConnectomeFileKey

  def lookUpConnectomeFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer, connectomeFileName: String)(
      implicit ec: ExecutionContext): Fox[ConnectomeFileKey] =
    connectomeFileKeyCache.getOrLoad(
      (dataSourceId, dataLayer.name, connectomeFileName),
      _ => lookUpConnectomeFileKeyImpl(dataSourceId, dataLayer, connectomeFileName).toFox)

  private def lookUpConnectomeFileKeyImpl(dataSourceId: DataSourceId,
                                          dataLayer: DataLayer,
                                          connectomeFileName: String): Box[ConnectomeFileKey] = {
    val registeredAttachment: Option[LayerAttachment] = dataLayer.attachments match {
      case Some(attachments) => attachments.connectomes.find(_.name == connectomeFileName)
      case None              => None
    }
    val localDatasetDir = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    for {
      registeredAttachmentNormalized <- tryo(registeredAttachment.map { attachment =>
        attachment.copy(
          path =
            remoteSourceDescriptorService.uriFromPathLiteral(attachment.path.toString, localDatasetDir, dataLayer.name))
      })
      localFallbackAttachment = LayerAttachment(
        connectomeFileName,
        localDatasetDir.resolve(dataLayer.name).resolve(localConnectomesDir).toUri,
        LayerAttachmentDataformat.hdf5
      )
      selectedAttachment = registeredAttachmentNormalized.getOrElse(localFallbackAttachment)
    } yield
      ConnectomeFileKey(
        dataSourceId,
        dataLayer.name,
        selectedAttachment
      )
  }

  def listConnectomeFiles(dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[List[ConnectomeFileNameWithMappingName]] = {
    val attachedConnectomeFileNames = dataLayer.attachments.map(_.connectomes).getOrElse(Seq.empty).map(_.name).toSet

    val layerDir =
      dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName).resolve(dataLayer.name)
    val scannedConnectomeFileNames = PathUtils
      .listFiles(layerDir.resolve(localConnectomesDir),
                 silent = true,
                 PathUtils.fileExtensionFilter(hdf5ConnectomeFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet

    val allConnectomeFileNames = attachedConnectomeFileNames ++ scannedConnectomeFileNames

    Fox.fromFuture(
      Fox
        .serialSequence(allConnectomeFileNames.toSeq) { connectomeFileName =>
          for {
            connectomeFileKey <- lookUpConnectomeFileKey(dataSourceId, dataLayer, connectomeFileName) ?~> Messages(
              "connectome.file.lookup.failed",
              connectomeFileName)
            mappingName <- mappingNameForConnectomeFile(connectomeFileKey) ?~> Messages(
              "connectome.file.readMappingName.failed",
              connectomeFileName)
          } yield ConnectomeFileNameWithMappingName(connectomeFileName, mappingName)
        }
        // Only return successes, we don’t want a malformed file breaking the list request.
        .map(_.flatten))
  }

  private def mappingNameForConnectomeFile(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext,
                                                                                 tc: TokenContext): Fox[String] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrConnectomeFileService.mappingNameForConnectomeFile(connectomeFileKey)
      case LayerAttachmentDataformat.hdf5  => hdf5ConnectomeFileService.mappingNameForConnectomeFile(connectomeFileKey)
      case _                               => unsupportedDataFormat(connectomeFileKey)
    }

  def synapsesForAgglomerates(connectomeFileKey: ConnectomeFileKey, agglomerateIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[DirectedSynapseList]] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrConnectomeFileService.synapsesForAgglomerates(connectomeFileKey, agglomerateIds)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5ConnectomeFileService.synapsesForAgglomerates(connectomeFileKey, agglomerateIds)
      case _ => unsupportedDataFormat(connectomeFileKey)
    }

  def synapticPartnerForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long], direction: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrConnectomeFileService.synapticPartnerForSynapses(connectomeFileKey, synapseIds, direction)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5ConnectomeFileService.synapticPartnerForSynapses(connectomeFileKey, synapseIds, direction)
      case _ => unsupportedDataFormat(connectomeFileKey)
    }

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[Long]]] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrConnectomeFileService.positionsForSynapses(connectomeFileKey, synapseIds)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5ConnectomeFileService.positionsForSynapses(connectomeFileKey, synapseIds)
      case _ => unsupportedDataFormat(connectomeFileKey)
    }

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SynapseTypesWithLegend] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrConnectomeFileService.typesForSynapses(connectomeFileKey, synapseIds)
      case LayerAttachmentDataformat.hdf5  => hdf5ConnectomeFileService.typesForSynapses(connectomeFileKey, synapseIds)
      case _                               => unsupportedDataFormat(connectomeFileKey)
    }

  private def unsupportedDataFormat(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext) =
    Fox.failure(
      s"Trying to load connectome file with unsupported data format ${connectomeFileKey.attachment.dataFormat}")

}
