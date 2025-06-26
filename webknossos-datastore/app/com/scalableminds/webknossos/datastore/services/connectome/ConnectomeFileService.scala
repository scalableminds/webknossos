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
    delegateToService(
      connectomeFileKey,
      zarrFn = zarrConnectomeFileService.mappingNameForConnectomeFile(connectomeFileKey),
      hdf5Fn = hdf5ConnectomeFileService.mappingNameForConnectomeFile(connectomeFileKey)
    )

  def synapsesForAgglomerates(connectomeFileKey: ConnectomeFileKey, agglomerateIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[DirectedSynapseList]] =
    if (agglomerateIds.length == 1) {
      for {
        agglomerateId <- agglomerateIds.headOption.toFox ?~> "Failed to extract the single agglomerate ID from request"
        inSynapses <- ingoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId) ?~> "Failed to read ingoing synapses"
        outSynapses <- outgoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId) ?~> "Failed to read outgoing synapses"
      } yield List(DirectedSynapseList(inSynapses, outSynapses))
    } else {
      val agglomeratePairs = directedPairs(agglomerateIds.toSet.toList)
      for {
        synapsesPerPair <- Fox.serialCombined(agglomeratePairs)(pair =>
          synapseIdsForDirectedPair(connectomeFileKey, pair._1, pair._2))
        synapseListsMap = gatherPairSynapseLists(agglomerateIds, agglomeratePairs, synapsesPerPair)
        synapseListsOrdered = agglomerateIds.map(id => synapseListsMap(id))
      } yield synapseListsOrdered
    }

  private def directedPairs(items: List[Long]): List[(Long, Long)] =
    (for { x <- items; y <- items } yield (x, y)).filter(pair => pair._1 != pair._2)

  private def gatherPairSynapseLists(agglomerateIds: List[Long],
                                     agglomeratePairs: List[(Long, Long)],
                                     synapsesPerPair: List[List[Long]]): collection.Map[Long, DirectedSynapseList] = {
    val directedSynapseListsMutable = scala.collection.mutable.Map[Long, DirectedSynapseListMutable]()
    agglomerateIds.foreach { agglomerateId =>
      directedSynapseListsMutable(agglomerateId) = DirectedSynapseListMutable.empty
    }
    agglomeratePairs.zip(synapsesPerPair).foreach { pairWithSynapses: ((Long, Long), List[Long]) =>
      val srcAgglomerate = pairWithSynapses._1._1
      val dstAgglomerate = pairWithSynapses._1._2
      directedSynapseListsMutable(srcAgglomerate).out ++= pairWithSynapses._2
      directedSynapseListsMutable(dstAgglomerate).in ++= pairWithSynapses._2
    }
    directedSynapseListsMutable.view.mapValues(_.freeze).toMap
  }

  private def ingoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] =
    delegateToService(
      connectomeFileKey,
      zarrFn = zarrConnectomeFileService.ingoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId),
      hdf5Fn = hdf5ConnectomeFileService.ingoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId)
    )

  private def outgoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] =
    delegateToService(
      connectomeFileKey,
      zarrFn = zarrConnectomeFileService.outgoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId),
      hdf5Fn = hdf5ConnectomeFileService.outgoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId)
    )

  private def synapseIdsForDirectedPair(
      connectomeFileKey: ConnectomeFileKey,
      srcAgglomerateId: Long,
      dstAgglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[Long]] =
    delegateToService(
      connectomeFileKey,
      zarrFn =
        zarrConnectomeFileService.synapseIdsForDirectedPair(connectomeFileKey, srcAgglomerateId, dstAgglomerateId),
      hdf5Fn =
        hdf5ConnectomeFileService.synapseIdsForDirectedPair(connectomeFileKey, srcAgglomerateId, dstAgglomerateId)
    )

  def synapticPartnerForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long], direction: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] =
    delegateToService(
      connectomeFileKey,
      zarrFn = zarrConnectomeFileService.synapticPartnerForSynapses(connectomeFileKey, synapseIds, direction),
      hdf5Fn = hdf5ConnectomeFileService.synapticPartnerForSynapses(connectomeFileKey, synapseIds, direction)
    )

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[Long]]] =
    delegateToService(
      connectomeFileKey,
      zarrFn = zarrConnectomeFileService.positionsForSynapses(connectomeFileKey, synapseIds),
      hdf5Fn = hdf5ConnectomeFileService.positionsForSynapses(connectomeFileKey, synapseIds)
    )

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SynapseTypesWithLegend] =
    delegateToService(
      connectomeFileKey,
      zarrFn = zarrConnectomeFileService.typesForSynapses(connectomeFileKey, synapseIds),
      hdf5Fn = hdf5ConnectomeFileService.typesForSynapses(connectomeFileKey, synapseIds)
    )

  private def delegateToService[A](connectomeFileKey: ConnectomeFileKey, zarrFn: Fox[A], hdf5Fn: Fox[A])(
      implicit ec: ExecutionContext): Fox[A] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrFn
      case LayerAttachmentDataformat.hdf5  => hdf5Fn
      case _ =>
        Fox.failure(
          s"Trying to load connectome file with unsupported data format ${connectomeFileKey.attachment.dataFormat}")
    }

}
