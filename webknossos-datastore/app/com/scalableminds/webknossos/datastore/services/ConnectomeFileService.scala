package com.scalableminds.webknossos.datastore.services

import java.nio.file.{Path, Paths}

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
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
      cachedConnectomeFile <- tryo { connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.initHDFReader) } ?~> "connectome.file.open.failed"
      fromAndTo: Array[Long] <- tryo { _: Throwable =>
        cachedConnectomeFile.finishAccess()
      } {
        cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/CSC_indptr", 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      from <- fromAndTo.lift(0) ?~> "Could not read start offset from connectome file"
      to <- fromAndTo.lift(1) ?~> "Could not read end offset from connectome file"
      agglomeratePairs: Array[Long] <- tryo { _: Throwable =>
        cachedConnectomeFile.finishAccess()
      } {
        cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/CSC_agglomerate_pair", (to - from).toInt, from)
      } ?~> "Could not read agglomerate pairs from connectome file"
      synapseIdsNested: List[Array[Long]] <- Fox.serialCombined(agglomeratePairs.toList) { agglomeratePair: Long =>
        tryo { _: Throwable =>
          cachedConnectomeFile.finishAccess()
        } {
          cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/agglomerate_pair_offsets", 1, agglomeratePair)
        }
      } ?~> "Could not read synapses from connectome file"
      synapseIdsFlat = synapseIdsNested.flatMap(_.toList)
      _ = cachedConnectomeFile.finishAccess()
    } yield synapseIdsFlat

  private def outgoingSynapsesForAgglomerate(connectomeFilePath: Path, agglomerateId: Long): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- tryo { connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.initHDFReader) } ?~> "connectome.file.open.failed"
      fromAndTo: Array[Long] <- tryo { _: Throwable =>
        cachedConnectomeFile.finishAccess()
      } {
        cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset("/CSC_indptr", 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      from <- fromAndTo.lift(0) ?~> "Could not read start offset from connectome file"
      to <- fromAndTo.lift(1) ?~> "Could not read end offset from connectome file"
      synapseStartEnd: Array[Long] <- tryo { _: Throwable =>
        cachedConnectomeFile.finishAccess()
      } {
        cachedConnectomeFile.reader
          .uint64()
          .readArrayBlockWithOffset("/agglomerate_pair_offsets", (to - from).toInt, from)
      } ?~> "Could not synapses from connectome file"
      synapseStart <- synapseStartEnd.lift(0) ?~> "Could not read start offset from connectome file"
      synapseEnd <- synapseStartEnd.lift(1) ?~> "Could not read end offset from connectome file"
    } yield List.range(synapseStart, synapseEnd)

  def synapticPartnerForSynapses(connectomeFilePath: Path, synapseIds: List[Long], direction: String): Fox[List[Long]] =
    for {
      _ <- bool2Fox(direction == "src" || direction == "dst") ?~> s"Invalid synaptic partner direction: $direction"
      collection = s"/synapse_to_${direction}_agglomerate"
      cachedConnectomeFile <- tryo { connectomeFileCache.withCache(connectomeFilePath)(CachedHdf5File.initHDFReader) } ?~> "connectome.file.open.failed"
      agglomerateIds <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        tryo { _: Throwable =>
          cachedConnectomeFile.finishAccess()
        } {
          cachedConnectomeFile.reader.uint64().readArrayBlockWithOffset(collection, 1, synapseId)
        }.flatMap(_.headOption)
      }
    } yield agglomerateIds

}
