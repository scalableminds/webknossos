package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.collections.SequenceUtils
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.connectome.SynapticPartnerDirection.SynapticPartnerDirection
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import com.scalableminds.webknossos.datastore.DataStoreConfig

import java.nio.file.Paths
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class Hdf5ConnectomeFileService @Inject()(config: DataStoreConfig) extends FoxImplicits with ConnectomeFileUtils {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)

  private lazy val fileHandleCache = new Hdf5FileCache(30)

  def mappingNameForConnectomeFile(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext): Fox[String] =
    for {
      cachedConnectomeFile <- fileHandleCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      mappingName <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.stringReader.getAttr("/", attrKeyMetadataMappingName)
      } ?~> "connectome.file.readEncoding.failed"
      _ = cachedConnectomeFile.finishAccess()
    } yield mappingName

  def ingoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[Seq[Long]] =
    for {
      cachedConnectomeFile <- fileHandleCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyCscIndptr, 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      from <- fromAndToPtr.lift(0).toFox ?~> "Could not read start offset from connectome file"
      to <- fromAndToPtr.lift(1).toFox ?~> "Could not read end offset from connectome file"
      // readArrayBlockWithOffset has a bug and does not return the empty array when block size 0 is passed, hence the if.
      agglomeratePairs: Array[Long] <- if (to - from == 0L) Fox.successful(Array.empty[Long])
      else
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyCscAgglomeratePair, (to - from).toInt, from)
        } ?~> "Could not read agglomerate pairs from connectome file"
      synapseIdsNested <- Fox.serialCombined(agglomeratePairs.toList) { agglomeratePair: Long =>
        for {
          from <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyAgglomeratePairOffsets, 1, agglomeratePair)
          }.flatMap(_.headOption.toFox)
          to <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyAgglomeratePairOffsets,
                                                                       1,
                                                                       agglomeratePair + 1)
          }.flatMap(_.headOption.toFox)
        } yield List.range(from, to)
      } ?~> "Could not read ingoing synapses from connectome file"
      _ = cachedConnectomeFile.finishAccess()
    } yield synapseIdsNested.flatten

  def outgoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[Seq[Long]] =
    for {
      cachedConnectomeFile <- fileHandleCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyCscIndptr, 2, agglomerateId)
      } ?~> "Could not read offsets from connectome file"
      fromPtr <- fromAndToPtr.lift(0).toFox ?~> "Could not read start offset from connectome file"
      toPtr <- fromAndToPtr.lift(1).toFox ?~> "Could not read end offset from connectome file"
      from <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyAgglomeratePairOffsets, 1, fromPtr)
      }.flatMap(_.headOption.toFox) ?~> "Could not synapses from connectome file"
      to <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyAgglomeratePairOffsets, 1, toPtr)
      }.flatMap(_.headOption.toFox) ?~> "Could not synapses from connectome file"
    } yield Seq.range(from, to)

  def synapticPartnerForSynapses(connectomeFileKey: ConnectomeFileKey,
                                 synapseIds: List[Long],
                                 direction: SynapticPartnerDirection)(implicit ec: ExecutionContext): Fox[List[Long]] =
    for {
      cachedConnectomeFile <- fileHandleCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      agglomerateIds <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(synapticPartnerKey(direction), 1, synapseId)
        }.flatMap(_.headOption.toFox)
      }
    } yield agglomerateIds

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext): Fox[List[List[Long]]] =
    for {
      cachedConnectomeFile <- fileHandleCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      synapsePositions <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readMatrixBlockWithOffset(keySynapsePositions, 1, 3, synapseId, 0)
        }.flatMap(_.headOption.toFox)
      }
    } yield synapsePositions.map(_.toList)

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext): Fox[SynapseTypesWithLegend] =
    for {
      cachedConnectomeFile <- fileHandleCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      // Hard coded type name list, as all legacy files have this value.
      typeNames = List("dendritic-shaft-synapse", "spine-head-synapse", "soma-synapse")
      synapseTypes <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keySynapseTypes, 1, synapseId)
        }.flatMap(_.headOption.toFox)
      }
    } yield SynapseTypesWithLegend(synapseTypes, typeNames)

  def synapseIdsForDirectedPair(connectomeFileKey: ConnectomeFileKey, srcAgglomerateId: Long, dstAgglomerateId: Long)(
      implicit ec: ExecutionContext): Fox[Seq[Long]] =
    for {
      cachedConnectomeFile <- fileHandleCache
        .getCachedHdf5File(connectomeFileKey.attachment)(CachedHdf5File.fromPath)
        .toFox ?~> "connectome.file.open.failed"
      fromAndToPtr: Array[Long] <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyCscIndptr, 2, srcAgglomerateId)
      } ?~> "Could not read offsets from connectome file"
      fromPtr <- fromAndToPtr.lift(0).toFox ?~> "Could not read start offset from connectome file"
      toPtr <- fromAndToPtr.lift(1).toFox ?~> "Could not read end offset from connectome file"
      columnValues: Array[Long] <- if (toPtr - fromPtr == 0L) Fox.successful(Array.empty[Long])
      else
        finishAccessOnFailure(cachedConnectomeFile) {
          cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyCsrIndices, (toPtr - fromPtr).toInt, fromPtr)
        } ?~> "Could not read agglomerate pairs from connectome file"
      columnOffset = SequenceUtils.searchSorted(columnValues, dstAgglomerateId)
      pairIndex = fromPtr + columnOffset
      synapses <- if ((columnOffset >= columnValues.length) || (columnValues(columnOffset) != dstAgglomerateId))
        Fox.successful(List.empty)
      else
        for {
          fromAndTo <- finishAccessOnFailure(cachedConnectomeFile) {
            cachedConnectomeFile.uint64Reader.readArrayBlockWithOffset(keyAgglomeratePairOffsets, 2, pairIndex)
          }
          from <- fromAndTo.lift(0).toFox
          to <- fromAndTo.lift(1).toFox
        } yield Seq.range(from, to)
    } yield synapses

  private def finishAccessOnFailure[T](f: CachedHdf5File)(block: => T)(implicit ec: ExecutionContext): Fox[T] =
    tryo { _: Throwable =>
      f.finishAccess()
    } {
      block
    }.toFox

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    val datasetPath = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val relevantPath = layerNameOpt.map(l => datasetPath.resolve(l)).getOrElse(datasetPath)
    fileHandleCache.clear(key => key.startsWith(relevantPath.toString))
  }
}
