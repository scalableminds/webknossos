package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  LayerAttachment,
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.services.connectome.SynapticPartnerDirection.SynapticPartnerDirection
import com.typesafe.scalalogging.LazyLogging
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ByAgglomerateIdsRequest(
    connectomeFile: String,
    agglomerateIds: Seq[Long]
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
    in: Seq[Long],
    out: Seq[Long]
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
    synapseTypes: Seq[Long],
    typeToString: Seq[String],
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

class ConnectomeFileService @Inject()(hdf5ConnectomeFileService: Hdf5ConnectomeFileService,
                                      zarrConnectomeFileService: ZarrConnectomeFileService,
                                      config: DataStoreConfig)
    extends FoxImplicits
    with LazyLogging {

  private val connectomeFileKeyCache
    : AlfuCache[(DataSourceId, String, String), ConnectomeFileKey] = AlfuCache() // dataSourceId, layerName, connectomeFileName → ConnectomeFileKey

  def lookUpConnectomeFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer, connectomeFileName: String)(
      implicit ec: ExecutionContext): Fox[ConnectomeFileKey] =
    connectomeFileKeyCache.getOrLoad(
      (dataSourceId, dataLayer.name, connectomeFileName),
      _ => lookUpConnectomeFileKeyImpl(dataSourceId, dataLayer, connectomeFileName).toFox)

  private def lookUpConnectomeFileKeyImpl(dataSourceId: DataSourceId,
                                          dataLayer: DataLayer,
                                          connectomeFileName: String): Box[ConnectomeFileKey] =
    for {
      attachment <- Box(dataLayer.attachments match {
        case Some(attachments) => attachments.connectomes.find(_.name == connectomeFileName)
        case None              => None
      })
      resolvedPath <- tryo(attachment.resolvedPath(config.Datastore.baseDirectory, dataSourceId))
    } yield
      ConnectomeFileKey(
        dataSourceId,
        dataLayer.name,
        attachment.copy(path = resolvedPath)
      )

  def listConnectomeFiles(dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[List[ConnectomeFileNameWithMappingName]] = {
    val connectomeFileNames = dataLayer.attachments.map(_.connectomes).getOrElse(Seq.empty).map(_.name)

    Fox.fromFuture(
      Fox
        .serialSequence(connectomeFileNames) { connectomeFileName =>
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

  def synapsesForAgglomerates(connectomeFileKey: ConnectomeFileKey, agglomerateIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[DirectedSynapseList]] =
    if (agglomerateIds.length == 1) {
      for {
        agglomerateId <- agglomerateIds.headOption.toFox ?~> "Failed to extract the single agglomerate ID from request"
        inSynapses <- ingoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId) ?~> "Failed to read ingoing synapses"
        outSynapses <- outgoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId) ?~> "Failed to read outgoing synapses"
      } yield List(DirectedSynapseList(inSynapses, outSynapses))
    } else {
      val agglomeratePairs = directedPairs(agglomerateIds.toSet.toSeq)
      for {
        synapsesPerPair <- Fox.serialCombined(agglomeratePairs)(pair =>
          synapseIdsForDirectedPair(connectomeFileKey, pair._1, pair._2))
        synapseListsMap = gatherPairSynapseLists(agglomerateIds, agglomeratePairs, synapsesPerPair)
        synapseListsOrdered = agglomerateIds.map(id => synapseListsMap(id))
      } yield synapseListsOrdered
    }

  private def directedPairs(items: Seq[Long]): Seq[(Long, Long)] =
    (for { x <- items; y <- items } yield (x, y)).filter(pair => pair._1 != pair._2)

  private def gatherPairSynapseLists(agglomerateIds: Seq[Long],
                                     agglomeratePairs: Seq[(Long, Long)],
                                     synapsesPerPair: List[Seq[Long]]): collection.Map[Long, DirectedSynapseList] = {
    val directedSynapseListsMutable = scala.collection.mutable.Map[Long, DirectedSynapseListMutable]()
    agglomerateIds.foreach { agglomerateId =>
      directedSynapseListsMutable(agglomerateId) = DirectedSynapseListMutable.empty
    }
    agglomeratePairs.zip(synapsesPerPair).foreach { pairWithSynapses: ((Long, Long), Seq[Long]) =>
      val srcAgglomerate = pairWithSynapses._1._1
      val dstAgglomerate = pairWithSynapses._1._2
      directedSynapseListsMutable(srcAgglomerate).out ++= pairWithSynapses._2
      directedSynapseListsMutable(dstAgglomerate).in ++= pairWithSynapses._2
    }
    directedSynapseListsMutable.view.mapValues(_.freeze).toMap
  }

  private def ingoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrConnectomeFileService.ingoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5ConnectomeFileService.ingoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId)
      case _ => unsupportedDataFormat(connectomeFileKey)
    }

  private def outgoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrConnectomeFileService.outgoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5ConnectomeFileService.outgoingSynapsesForAgglomerate(connectomeFileKey, agglomerateId)
      case _ => unsupportedDataFormat(connectomeFileKey)
    }

  private def synapseIdsForDirectedPair(
      connectomeFileKey: ConnectomeFileKey,
      srcAgglomerateId: Long,
      dstAgglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrConnectomeFileService.synapseIdsForDirectedPair(connectomeFileKey, srcAgglomerateId, dstAgglomerateId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5ConnectomeFileService.synapseIdsForDirectedPair(connectomeFileKey, srcAgglomerateId, dstAgglomerateId)
      case _ => unsupportedDataFormat(connectomeFileKey)
    }

  def synapticPartnerForSynapses(
      connectomeFileKey: ConnectomeFileKey,
      synapseIds: List[Long],
      direction: SynapticPartnerDirection)(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[Long]] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrConnectomeFileService.synapticPartnerForSynapses(connectomeFileKey, synapseIds, direction)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5ConnectomeFileService.synapticPartnerForSynapses(connectomeFileKey, synapseIds, direction)
      case _ => unsupportedDataFormat(connectomeFileKey)
    }

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Seq[Long]]] =
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

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    connectomeFileKeyCache.clear {
      case (keyDataSourceId, keyLayerName, _) =>
        dataSourceId == keyDataSourceId && layerNameOpt.forall(_ == keyLayerName)
    }

    val clearedHdf5Count = hdf5ConnectomeFileService.clearCache(dataSourceId, layerNameOpt)

    val clearedZarrCount = zarrConnectomeFileService.clearCache(dataSourceId, layerNameOpt)

    clearedHdf5Count + clearedZarrCount
  }

  private def unsupportedDataFormat(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext) =
    Fox.failure(
      s"Trying to load connectome file with unsupported data format ${connectomeFileKey.attachment.dataFormat}")

}
