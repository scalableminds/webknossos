package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}

import javax.inject.Inject
import scala.collection.Searching.{Found, InsertionPoint}
import scala.concurrent.ExecutionContext

class Hdf5ConnectomeFileService @Inject()() extends FoxImplicits {

  private lazy val connectomeFileCache = new Hdf5FileCache(30)

  def mappingNameForConnectomeFile(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext): Fox[String] =
    for {
      cachedConnectomeFile <- connectomeFileCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      mappingName <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.stringReader.getAttr("/", "metadata/mapping_name")
      } ?~> "connectome.file.readEncoding.failed"
      _ = cachedConnectomeFile.finishAccess()
    } yield mappingName

  def ingoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- connectomeFileCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
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

  def outgoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- connectomeFileCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
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

  def synapticPartnerForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long], direction: String)(
      implicit ec: ExecutionContext): Fox[List[Long]] =
    for {
      _ <- Fox.fromBool(direction == "src" || direction == "dst") ?~> s"Invalid synaptic partner direction: $direction"
      collection = s"/synapse_to_${direction}_agglomerate"
      cachedConnectomeFile <- connectomeFileCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      agglomerateIds <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(collection, 1, synapseId)
        }.flatMap(_.headOption.toFox)
      }
    } yield agglomerateIds

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext): Fox[List[List[Long]]] =
    for {
      cachedConnectomeFile <- connectomeFileCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      synapsePositions <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readMatrixBlockWithOffset("/synapse_positions", 1, 3, synapseId, 0)
        }.flatMap(_.headOption.toFox)
      }
    } yield synapsePositions.map(_.toList)

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext): Fox[SynapseTypesWithLegend] =
    for {
      cachedConnectomeFile <- connectomeFileCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      // Hard coded type name list, as all legacy files have this value.
      typeNames = List("dendritic-shaft-synapse", "spine-head-synapse", "soma-synapse")
      synapseTypes <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset("/synapse_types", 1, synapseId)
        }.flatMap(_.headOption.toFox)
      }
    } yield SynapseTypesWithLegend(synapseTypes, typeNames)

  def synapseIdsForDirectedPair(connectomeFileKey: ConnectomeFileKey, srcAgglomerateId: Long, dstAgglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- connectomeFileCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
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
      columnOffset <- searchSorted(columnValues, dstAgglomerateId).toFox
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

  private def searchSorted(haystack: Array[Long], needle: Long): Box[Int] =
    haystack.search(needle) match {
      case Found(i)          => Full(i)
      case InsertionPoint(i) => Full(i)
    }

  private def finishAccessOnFailure[T](f: CachedHdf5File)(block: => T)(implicit ec: ExecutionContext): Fox[T] =
    tryo { _: Throwable =>
      f.finishAccess()
    } {
      block
    }.toFox
}
