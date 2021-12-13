package com.scalableminds.webknossos.datastore.services

import java.io.File
import java.nio.file.{Path, Paths}

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.Full
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Json, OFormat}

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

class ConnectomeFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val connectomesDir = "connectomes"
  private val connectomeFileExtension = "hdf5"

  private lazy val connectomeFileCache = new Hdf5FileCache(30)

  def exploreConnectomeFiles(organizationName: String, dataSetName: String, dataLayerName: String): Set[String] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName)
    PathUtils
      .listFiles(layerDir.resolve(connectomesDir), PathUtils.fileExtensionFilter(connectomeFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet
  }

  def connectomeFilePath(organizationName: String,
                         dataSetName: String,
                         dataLayerName: String,
                         connectomeFileName: String): Path =
    dataBaseDir
      .resolve(organizationName)
      .resolve(dataSetName)
      .resolve(dataLayerName)
      .resolve(connectomesDir)
      .resolve(s"$connectomeFileName.$connectomeFileExtension")

  def mappingNameForConnectomeFile(connectomeFilePath: Path): Fox[String] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.fromPath)
      } ?~> "connectome.file.open.failed"
      mappingName <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.reader.string().getAttr("/", "metadata/mapping_name")
      } ?~> "connectome.file.readEncoding.failed"
      _ = cachedConnectomeFile.finishAccess()
    } yield mappingName

  def synapsesForAgglomerates(connectomeFilePath: Path, agglomerateIds: List[Long]): Fox[List[DirectedSynapseList]] =
    if (agglomerateIds.length == 1) {
      for {
        agglomerateId <- agglomerateIds.headOption.toFox ?~> "Failed to extract the single agglomerate ID from request"
        inSynapses <- ingoingSynapsesForAgglomerate(connectomeFilePath, agglomerateId) ?~> "Failed to read ingoing synapses"
        outSynapses <- outgoingSynapsesForAgglomerate(connectomeFilePath, agglomerateId) ?~> "Failed to read outgoing synapses"
      } yield List(DirectedSynapseList(inSynapses, outSynapses))
    } else {
      Fox.failure("Synapses between multiple agglomerates is not yet implemented")
    }

  private def ingoingSynapsesForAgglomerate(connectomeFilePath: Path, agglomerateId: Long): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.fromPath)
      } ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/CSC_indptr", 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      from <- fromAndToPtr.lift(0) ?~> "Could not read start offset from connectome file"
      to <- fromAndToPtr.lift(1) ?~> "Could not read end offset from connectome file"
      // readArrayBlockWithOffset has a bug and does not return the empty array when block size 0 is passed, hence the if.
      agglomeratePairs: Array[Long] <- if (to - from == 0L) Fox.successful(Array.empty[Long])
      else
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.reader
            .uint64()
            .readArrayBlockWithOffset("/CSC_agglomerate_pair", (to - from).toInt, from)
        } ?~> "Could not read agglomerate pairs from connectome file"
      synapseIdsNested <- Fox.serialCombined(agglomeratePairs.toList) { agglomeratePair: Long =>
        for {
          from <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.reader
              .uint64()
              .readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, agglomeratePair)
          }.flatMap(_.headOption)
          to <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.reader
              .uint64()
              .readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, agglomeratePair + 1)
          }.flatMap(_.headOption)
        } yield List.range(from, to)
      } ?~> "Could not read ingoing synapses from connectome file"
      _ = cachedConnectomeFile.finishAccess()
    } yield synapseIdsNested.flatten

  private def outgoingSynapsesForAgglomerate(connectomeFilePath: Path, agglomerateId: Long): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.fromPath)
      } ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/CSR_indptr", 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      fromPtr <- fromAndToPtr.lift(0) ?~> "Could not read start offset from connectome file"
      toPtr <- fromAndToPtr.lift(1) ?~> "Could not read end offset from connectome file"
      from <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, fromPtr)
      }.flatMap(_.headOption) ?~> "Could not synapses from connectome file"
      to <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, toPtr)
      }.flatMap(_.headOption) ?~> "Could not synapses from connectome file"
    } yield List.range(from, to)

  def synapticPartnerForSynapses(connectomeFilePath: Path, synapseIds: List[Long], direction: String): Fox[List[Long]] =
    for {
      _ <- bool2Fox(direction == "src" || direction == "dst") ?~> s"Invalid synaptic partner direction: $direction"
      collection = s"/synapse_to_${direction}_agglomerate"
      cachedConnectomeFile <- tryo {
        connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.fromPath)
      } ?~> "connectome.file.open.failed"
      agglomerateIds <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset(collection, 1, synapseId)
        }.flatMap(_.headOption)
      }
    } yield agglomerateIds

  def positionsForSynapses(connectomeFilePath: Path, synapseIds: List[Long]): Fox[List[List[Long]]] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.fromPath)
      } ?~> "connectome.file.open.failed"
      synapsePositions <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.reader.uint64().readMatrixBlockWithOffset("/synapse_positions", 1, 3, synapseId, 0)
        }.flatMap(_.headOption)
      }
    } yield synapsePositions.map(_.toList)

  def typesForSynapses(connectomeFilePath: Path, synapseIds: List[Long]): Fox[SynapseTypesWithLegend] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.fromPath)
      } ?~> "connectome.file.open.failed"
      typeNames = typeNamesForSynapsesOrEmpty(connectomeFilePath)
      synapseTypes <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/synapse_types", 1, synapseId)
        }.flatMap(_.headOption)
      }
    } yield SynapseTypesWithLegend(synapseTypes, typeNames)

  private def typeNamesForSynapsesOrEmpty(connectomeFilePath: Path): List[String] = {
    val typeNamesPath = Paths.get(s"${connectomeFilePath.toString.dropRight(connectomeFileExtension.length)}json")
    if (new File(typeNamesPath.toString).exists()) {
      JsonHelper.validatedJsonFromFile[ConnectomeLegend](typeNamesPath, typeNamesPath.getParent) match {
        case Full(connectomeLegend) => connectomeLegend.synapse_type_names
        case _                      => List.empty
      }
    } else List.empty
  }

  private def finishAccessOnFailure[T](f: CachedHdf5File)(block: => T): Fox[T] =
    tryo { _: Throwable =>
      f.finishAccess()
    } {
      block
    }.toFox

}
