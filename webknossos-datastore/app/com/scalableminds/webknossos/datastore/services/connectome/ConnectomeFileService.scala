package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, Full, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  LayerAttachment,
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.services.mesh.{MeshFileInfo, MeshFileKey}
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache, RemoteSourceDescriptorService}
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FilenameUtils
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Json, OFormat}

import java.io.File
import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.collection.Searching._
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

class ConnectomeFileService @Inject()(
    config: DataStoreConfig,
    remoteSourceDescriptorService: RemoteSourceDescriptorService,
    hdf5ConnectomeFileService: Hdf5ConnectomeFileService,
    zarrConnectomeFileService: ZarrConnectomeFileService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val localConnectomesDir = "connectomes"
  private val hdf5ConnectomeFileExtension = "hdf5"

  private val connectomeFileKeyCache
    : AlfuCache[(DataSourceId, String, String), ConnectomeFileKey] = AlfuCache() // dataSourceId, layerName, attachmentName → MeshFileKey

  def lookUpConnectomeFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer, connectomeFileName: String)(
      implicit ec: ExecutionContext): Fox[ConnectomeFileKey] =
    connectomeFileKeyCache.getOrLoad(
      (dataSourceId, dataLayer.name, connectomeFileName),
      _ => lookUpConnectomeFileKeyImpl(dataSourceId, dataLayer, connectomeFileName).toFox)

  private def lookUpConnectomeFileKeyImpl(dataSourceId: DataSourceId,
                                          dataLayer: DataLayer,
                                          connectomeFileName: String): Box[ConnectomeFileKey] = {
    val registeredAttachment: Option[LayerAttachment] = dataLayer.attachments match {
      case Some(attachments) => attachments.meshes.find(_.name == connectomeFileName)
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
    val attachedConnectomeFileNames = dataLayer.attachments.map(_.meshes).getOrElse(Seq.empty).map(_.name).toSet

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

  def connectomeFilePath(organizationId: String,
                         datasetDirectoryName: String,
                         dataLayerName: String,
                         connectomeFileName: String): Path =
    dataBaseDir
      .resolve(organizationId)
      .resolve(datasetDirectoryName)
      .resolve(dataLayerName)
      .resolve(connectomesDir)
      .resolve(s"$connectomeFileName.$connectomeFileExtension")

  def mappingNameForConnectomeFile(connectomeFileKey: ConnectomeFileKey): Fox[String] =
    connectomeFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrConnectomeFileService.mappingNameForConnectomeFile(connectomeFileKey)
      case LayerAttachmentDataformat.hdf5  => hdf5ConnectomeFileService.mappingNameForConnectomeFile(connectomeFileKey)
      case _                               => unsupportedDataFormat(connectomeFileKey)
    }

  def synapsesForAgglomerates(connectomeFilePath: Path, agglomerateIds: List[Long]): Fox[List[DirectedSynapseList]] =
    if (agglomerateIds.length == 1) {
      for {
        agglomerateId <- agglomerateIds.headOption.toFox ?~> "Failed to extract the single agglomerate ID from request"
        inSynapses <- ingoingSynapsesForAgglomerate(connectomeFilePath, agglomerateId) ?~> "Failed to read ingoing synapses"
        outSynapses <- outgoingSynapsesForAgglomerate(connectomeFilePath, agglomerateId) ?~> "Failed to read outgoing synapses"
      } yield List(DirectedSynapseList(inSynapses, outSynapses))
    } else {
      val agglomeratePairs = directedPairs(agglomerateIds.toSet.toList)
      for {
        synapsesPerPair <- Fox.serialCombined(agglomeratePairs)(pair =>
          synapseIdsForDirectedPair(connectomeFilePath, pair._1, pair._2))
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

  private def ingoingSynapsesForAgglomerate(connectomeFilePath: Path, agglomerateId: Long): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.getCachedHdf5File(connectomeFilePath)(CachedHdf5File.fromPath)
      }.toFox ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/CSC_indptr", 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      from <- fromAndToPtr.lift(0).toFox ?~> "Could not read start offset from connectome file"
      to <- fromAndToPtr.lift(1).toFox ?~> "Could not read end offset from connectome file"
      // readArrayBlockWithOffset has a bug and does not return the empty array when block size 0 is passed, hence the if.
      agglomeratePairs: Array[Long] <- if (to - from == 0L) Fox.successful(Array.empty[Long])
      else
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/CSC_agglomerate_pair", (to - from).toInt, from)
        } ?~> "Could not read agglomerate pairs from connectome file"
      synapseIdsNested <- Fox.serialCombined(agglomeratePairs.toList) { agglomeratePair: Long =>
        for {
          from <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, agglomeratePair)
          }.flatMap(_.headOption.toFox)
          to <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/agglomerate_pair_offsets",
                                                                       1,
                                                                       agglomeratePair + 1)
          }.flatMap(_.headOption.toFox)
        } yield List.range(from, to)
      } ?~> "Could not read ingoing synapses from connectome file"
      _ = cachedConnectomeFile.finishAccess()
    } yield synapseIdsNested.flatten

  private def outgoingSynapsesForAgglomerate(connectomeFilePath: Path, agglomerateId: Long): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.getCachedHdf5File(connectomeFilePath)(CachedHdf5File.fromPath)
      }.toFox ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/CSR_indptr", 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      fromPtr <- fromAndToPtr.lift(0).toFox ?~> "Could not read start offset from connectome file"
      toPtr <- fromAndToPtr.lift(1).toFox ?~> "Could not read end offset from connectome file"
      from <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, fromPtr)
      }.flatMap(_.headOption.toFox) ?~> "Could not synapses from connectome file"
      to <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, toPtr)
      }.flatMap(_.headOption.toFox) ?~> "Could not synapses from connectome file"
    } yield List.range(from, to)

  def synapticPartnerForSynapses(connectomeFilePath: Path, synapseIds: List[Long], direction: String): Fox[List[Long]] =
    for {
      _ <- Fox.fromBool(direction == "src" || direction == "dst") ?~> s"Invalid synaptic partner direction: $direction"
      collection = s"/synapse_to_${direction}_agglomerate"
      cachedConnectomeFile <- tryo {
        connectomeFileCache.getCachedHdf5File(connectomeFilePath)(CachedHdf5File.fromPath)
      }.toFox ?~> "connectome.file.open.failed"
      agglomerateIds <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(collection, 1, synapseId)
        }.flatMap(_.headOption.toFox)
      }
    } yield agglomerateIds

  def positionsForSynapses(connectomeFilePath: Path, synapseIds: List[Long]): Fox[List[List[Long]]] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.getCachedHdf5File(connectomeFilePath)(CachedHdf5File.fromPath)
      }.toFox ?~> "connectome.file.open.failed"
      synapsePositions <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readMatrixBlockWithOffset("/synapse_positions", 1, 3, synapseId, 0)
        }.flatMap(_.headOption.toFox)
      }
    } yield synapsePositions.map(_.toList)

  def typesForSynapses(connectomeFilePath: Path, synapseIds: List[Long]): Fox[SynapseTypesWithLegend] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.getCachedHdf5File(connectomeFilePath)(CachedHdf5File.fromPath)
      }.toFox ?~> "connectome.file.open.failed"
      typeNames = typeNamesForSynapsesOrEmpty(connectomeFilePath)
      synapseTypes <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/synapse_types", 1, synapseId)
        }.flatMap(_.headOption.toFox)
      }
    } yield SynapseTypesWithLegend(synapseTypes, typeNames)

  private def typeNamesForSynapsesOrEmpty(connectomeFilePath: Path): List[String] = {
    val typeNamesPath = Paths.get(s"${connectomeFilePath.toString.dropRight(connectomeFileExtension.length)}json")
    if (new File(typeNamesPath.toString).exists()) {
      JsonHelper.parseFromFileAs[ConnectomeLegend](typeNamesPath, typeNamesPath.getParent) match {
        case Full(connectomeLegend) => connectomeLegend.synapse_type_names
        case _                      => List.empty
      }
    } else List.empty
  }

  private def synapseIdsForDirectedPair(connectomeFilePath: Path,
                                        srcAgglomerateId: Long,
                                        dstAgglomerateId: Long): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.getCachedHdf5File(connectomeFilePath)(CachedHdf5File.fromPath)
      }.toFox ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/CSR_indptr", 2, srcAgglomerateId)
      } ?~> "Could not read offsets from connectome file"
      fromPtr <- fromAndToPtr.lift(0).toFox ?~> "Could not read start offset from connectome file"
      toPtr <- fromAndToPtr.lift(1).toFox ?~> "Could not read end offset from connectome file"
      columnValues: Array[Long] <- if (toPtr - fromPtr == 0L) Fox.successful(Array.empty[Long])
      else
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/CSR_indices", (toPtr - fromPtr).toInt, fromPtr)
        } ?~> "Could not read agglomerate pairs from connectome file"
      columnOffset <- searchSorted(columnValues, dstAgglomerateId)
      pairIndex = fromPtr + columnOffset
      synapses <- if ((columnOffset >= columnValues.length) || (columnValues(columnOffset) != dstAgglomerateId))
        Fox.successful(List.empty)
      else
        for {
          fromAndTo <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/agglomerate_pair_offsets", 2, pairIndex)
          }
          from <- fromAndTo.lift(0).toFox
          to <- fromAndTo.lift(1).toFox
        } yield List.range(from, to)
    } yield synapses

  private def searchSorted(haystack: Array[Long], needle: Long): Fox[Int] =
    haystack.search(needle) match {
      case Found(i)          => Fox.successful(i)
      case InsertionPoint(i) => Fox.successful(i)
    }

  private def finishAccessOnFailure[T](f: CachedHdf5File)(block: => T): Fox[T] =
    tryo { _: Throwable =>
      f.finishAccess()
    } {
      block
    }.toFox

  private def unsupportedDataFormat(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext) =
    Fox.failure(
      s"Trying to load connectome file with unsupported data format ${connectomeFileKey.attachment.dataFormat}")

}
