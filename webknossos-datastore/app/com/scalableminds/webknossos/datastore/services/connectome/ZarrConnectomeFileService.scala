package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.collections.SequenceUtils
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.ChunkCacheService
import com.scalableminds.webknossos.datastore.services.connectome.SynapticPartnerDirection.SynapticPartnerDirection
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import jakarta.inject.Inject
import play.api.libs.json.{JsResult, JsValue, Reads}

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
        mappingName <- (connectomeFileAttrs \ "metadata/mapping_name").validate[String]
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
  private val keySynapseTypes = "synapse_types"
  private val keySynapsePositions = "synapse_positions"
  private val keySynapseToSrcAgglomerate = "synapse_to_src_agglomerate"
  private val keySynapseToDstAgglomerate = "synapse_to_dst_agglomerate"

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

  def synapticPartnerForSynapses(
      connectomeFileKey: ConnectomeFileKey,
      synapseIds: List[Long],
      direction: SynapticPartnerDirection)(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[Long]] = {
    val arrayKey = direction match {
      case SynapticPartnerDirection.src => keySynapseToSrcAgglomerate
      case SynapticPartnerDirection.dst => keySynapseToDstAgglomerate
    }
    for {
      synapseToPartnerAgglomerateArray <- openZarrArray(connectomeFileKey, arrayKey)
      agglomerateIds <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        for {
          agglomerateIdMA <- synapseToPartnerAgglomerateArray.readAsMultiArray(offset = synapseId, shape = 1)
          agglomerateId <- tryo(agglomerateIdMA.getLong(0)).toFox
        } yield agglomerateId
      }
    } yield agglomerateIds
  }

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Seq[Long]]] =
    for {
      arraySynapsePositions <- openZarrArray(connectomeFileKey, keySynapsePositions)
      synapsePositions <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        for {
          synapsePositionMA <- arraySynapsePositions.readAsMultiArray(offset = Array(synapseId, 0), shape = Array(1, 3)) // TODO should offset and shape be transposed?
          synapsePosition <- tryo(synapsePositionMA.getStorage.asInstanceOf[Array[Long]].toSeq).toFox
        } yield synapsePosition
      }
    } yield synapsePositions

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SynapseTypesWithLegend] =
    for {
      arraySynapseTypes <- openZarrArray(connectomeFileKey, keySynapseTypes)
      attributes <- readConnectomeFileAttributes(connectomeFileKey)
      synapseTypes <- Fox.serialCombined(synapseIds) { synapseId: Long =>
        for {
          synapseTypeMA <- arraySynapseTypes.readAsMultiArray(offset = synapseId, shape = 1)
          synapseType <- tryo(synapseTypeMA.getLong(0)).toFox
        } yield synapseType
      }
    } yield SynapseTypesWithLegend(synapseTypes, attributes.synapseTypeNames)

  def ingoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] =
    for {
      (fromPtr, toPtr) <- getToAndFromPtr(connectomeFileKey, agglomerateId)
      agglomeratePairOffsetsArray <- openZarrArray(connectomeFileKey, keyAgglomeratePairOffsets)
      cscAgglomeratePairArray <- openZarrArray(connectomeFileKey, keyCscAgglomeratePair)
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

  private def getToAndFromPtr(connectomeFileKey: ConnectomeFileKey,
                              agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] =
    for {
      csrIndptrArray <- openZarrArray(connectomeFileKey, keyCsrIndptr)
      fromAndToPtr <- csrIndptrArray.readAsMultiArray(offset = agglomerateId, shape = 2)
      fromPtr <- tryo(fromAndToPtr.getLong(0)).toFox
      toPtr <- tryo(fromAndToPtr.getLong(1)).toFox
    } yield (fromPtr, toPtr)

  def outgoingSynapsesForAgglomerate(connectomeFileKey: ConnectomeFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    for {
      (fromPtr, toPtr) <- getToAndFromPtr(connectomeFileKey, agglomerateId)
      agglomeratePairOffsetsArray <- openZarrArray(connectomeFileKey, keyAgglomeratePairOffsets)
      fromMA <- agglomeratePairOffsetsArray.readAsMultiArray(offset = fromPtr, shape = 1)
      from <- tryo(fromMA.getLong(0)).toFox
      toMA <- agglomeratePairOffsetsArray.readAsMultiArray(offset = toPtr, shape = 1)
      to <- tryo(toMA.getLong(0)).toFox
    } yield Seq.range(from, to)

  def synapseIdsForDirectedPair(connectomeFileKey: ConnectomeFileKey, srcAgglomerateId: Long, dstAgglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    for {
      csrIndicesArray <- openZarrArray(connectomeFileKey, keyCsrIndices)
      (fromPtr, toPtr) <- getToAndFromPtr(connectomeFileKey, srcAgglomerateId)
      columnValuesMA <- csrIndicesArray.readAsMultiArray(offset = fromPtr, shape = (toPtr - fromPtr).toInt)
      columnValues: Array[Long] <- tryo(columnValuesMA.getStorage.asInstanceOf[Array[Long]]).toFox
      columnOffset = SequenceUtils.searchSorted(columnValues, dstAgglomerateId)
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

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    openArraysCache.clear {
      case (meshFileKey, _) =>
        meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }
  }
}
