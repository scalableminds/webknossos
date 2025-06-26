package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, Full, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.ChunkCacheService
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import jakarta.inject.Inject
import play.api.libs.json.{JsResult, JsValue, Reads}

import scala.collection.Searching.{Found, InsertionPoint}
import scala.concurrent.ExecutionContext

case class ConnectomeFileAttributes(
    formatVersion: Long,
    mappingName: String,
    synapseTypeNames: Seq[String]
)

object ConnectomeFileAttributes {
  val FILENAME_ZARR_JSON = "zarr.json"

  implicit object ConnectomeFileAttributesZarr3GroupHeaderReads extends Reads[ConnectomeFileAttributes] {
    override def reads(json: JsValue): JsResult[ConnectomeFileAttributes] = {
      val keyAttributes = "attributes"
      val keyVx = "voxelytics"
      val keyFormatVersion = "artifact_schema_version"
      val keyArtifactAttrs = "artifact_attributes"
      val connectomeFileAttrs = json \ keyAttributes \ keyVx \ keyArtifactAttrs
      for {
        formatVersion <- (json \ keyAttributes \ keyVx \ keyFormatVersion).validate[Long]
        mappingName <- (connectomeFileAttrs \ "mapping_name").validate[String]
        synapseTypeNames <- (connectomeFileAttrs \ "synapse_type_names").validate[Seq[String]]
      } yield
        ConnectomeFileAttributes(
          formatVersion,
          mappingName,
          synapseTypeNames
        )
    }
  }
}

class ZarrConnectomeFileService @Inject()(remoteSourceDescriptorService: RemoteSourceDescriptorService,
                                          chunkCacheService: ChunkCacheService)
    extends FoxImplicits {
  private lazy val openArraysCache = AlfuCache[(ConnectomeFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[ConnectomeFileKey, ConnectomeFileAttributes]()

  private val keyCsrIndptr = "CSR_indptr"
  private val keyCsrIndices = "CSR_indices"
  private val keyAgglomeratePairOffsets = "agglomerate_pair_offsets"
  private val keyCscAgglomeratePair = "CSC_agglomerate_pair"

  private def readConnectomeFileAttributes(connectomeFileKey: ConnectomeFileKey)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[ConnectomeFileAttributes] =
    attributesCache.getOrLoad(
      connectomeFileKey,
      _ =>
        for {
          groupVaultPath <- remoteSourceDescriptorService.vaultPathFor(connectomeFileKey.attachment)
          groupHeaderBytes <- (groupVaultPath / ConnectomeFileAttributes.FILENAME_ZARR_JSON).readBytes()
          connectomeFileAttributes <- JsonHelper
            .parseAs[ConnectomeFileAttributes](groupHeaderBytes)
            .toFox ?~> "Could not parse connectome file attributes from zarr group file"
        } yield connectomeFileAttributes
    )

  def mappingNameForConnectomeFile(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext,
                                                                         tc: TokenContext): Fox[String] =
    for {
      attributes <- readConnectomeFileAttributes(connectomeFileKey)
    } yield attributes.mappingName

  def synapticPartnerForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long], direction: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] = ???

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[Long]]] = ???

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SynapseTypesWithLegend] = ???

  def ingoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] =
    for {
      csrIndptrArray <- openZarrArray(connectomeFileKey, keyCsrIndptr)
      agglomeratePairOffsetsArray <- openZarrArray(connectomeFileKey, keyAgglomeratePairOffsets)
      cscAgglomeratePairArray <- openZarrArray(connectomeFileKey, keyCscAgglomeratePair)
      fromAndToPtr <- csrIndptrArray.readAsMultiArray(offset = agglomerateId, shape = 2)
      fromPtr <- tryo(fromAndToPtr.getLong(0)).toFox
      toPtr <- tryo(fromAndToPtr.getLong(1)).toFox
      agglomeratePairsMA <- cscAgglomeratePairArray.readAsMultiArray(offset = fromPtr, shape = (toPtr - fromPtr).toInt)
      agglomeratePairs <- tryo(agglomeratePairsMA.getStorage.asInstanceOf[Array[Long]]).toFox
      synapseIdsNested <- Fox.serialCombined(agglomeratePairs.toList) { agglomeratePair: Long =>
        for {
          fromTo <- agglomeratePairOffsetsArray.readAsMultiArray(offset = agglomeratePair, shape = 2)
          from <- tryo(fromTo.getLong(0)).toFox
          to <- tryo(fromTo.getLong(1)).toFox
        } yield Seq.range(from, to)
      }
    } yield synapseIdsNested.flatten

  def outgoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] = ???

  def synapseIdsForDirectedPair(connectomeFileKey: ConnectomeFileKey, srcAgglomerateId: Long, dstAgglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    for {
      csrIndptrArray <- openZarrArray(connectomeFileKey, keyCsrIndptr)
      csrIndicesArray <- openZarrArray(connectomeFileKey, keyCsrIndices)
      fromAndToPtr <- csrIndptrArray.readAsMultiArray(offset = srcAgglomerateId, shape = 2)
      fromPtr <- tryo(fromAndToPtr.getLong(0)).toFox
      toPtr <- tryo(fromAndToPtr.getLong(1)).toFox
      columnValuesMA <- csrIndicesArray.readAsMultiArray(offset = fromPtr, shape = (toPtr - fromPtr).toInt)
      columnValues: Array[Long] <- tryo(columnValuesMA.getStorage.asInstanceOf[Array[Long]]).toFox
      columnOffset <- searchSorted(columnValues, dstAgglomerateId).toFox
      pairIndex = fromPtr + columnOffset
      synapses <- if ((columnOffset >= columnValues.length) || (columnValues(columnOffset) != dstAgglomerateId))
        Fox.successful(List.empty)
      else
        for {
          agglomeratePairOffsetsArray <- openZarrArray(connectomeFileKey, keyAgglomeratePairOffsets)
          fromAndTo <- agglomeratePairOffsetsArray.readAsMultiArray(offset = pairIndex, shape = 2)
          from <- tryo(fromAndTo.getLong(0)).toFox
          to <- tryo(fromAndTo.getLong(1)).toFox
        } yield Seq.range(from, to)
    } yield synapses

  // TODO move to utils?
  private def searchSorted(haystack: Array[Long], needle: Long): Box[Int] =
    haystack.search(needle) match {
      case Found(i)          => Full(i)
      case InsertionPoint(i) => Full(i)
    }

  private def openZarrArray(connectomeFileKey: ConnectomeFileKey,
                            zarrArrayName: String)(implicit ec: ExecutionContext, tc: TokenContext): Fox[DatasetArray] =
    openArraysCache.getOrLoad(
      (connectomeFileKey, zarrArrayName),
      _ =>
        for {
          groupVaultPath <- remoteSourceDescriptorService.vaultPathFor(connectomeFileKey.attachment)
          zarrArray <- Zarr3Array.open(groupVaultPath / zarrArrayName,
                                       DataSourceId("dummy", "unused"),
                                       "layer",
                                       None,
                                       None,
                                       None,
                                       chunkCacheService.sharedChunkContentsCache)
        } yield zarrArray
    )
}
