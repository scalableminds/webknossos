package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, SkeletonTracing, Tree, TreeTypeProto}
import com.scalableminds.webknossos.datastore.datareaders.{DatasetArray, MultiArrayUtils}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, ElementClass, LayerAttachment}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Full}
import ucar.ma2.{Array => MultiArray}

import java.nio.{ByteBuffer, ByteOrder, LongBuffer}
import javax.inject.Inject
import scala.collection.compat.immutable.ArraySeq
import scala.concurrent.ExecutionContext

class ZarrAgglomerateService @Inject()(config: DataStoreConfig, dataVaultService: DataVaultService)
    extends DataConverter
    with LazyLogging {

  private lazy val openArraysCache = AlfuCache[(LayerAttachment, String), DatasetArray]()

  // TODO unify with existing chunkContentsCache from binaryDataService?
  private lazy val sharedChunkContentsCache: AlfuCache[String, MultiArray] = {
    // Used by DatasetArray-based datasets. Measure item weight in kilobytes because the weigher can only return int, not long

    val maxSizeKiloBytes = Math.floor(config.Datastore.Cache.ImageArrayChunks.maxSizeBytes.toDouble / 1000.0).toInt

    def cacheWeight(key: String, arrayBox: Box[MultiArray]): Int =
      arrayBox match {
        case Full(array) =>
          (array.getSizeBytes / 1000L).toInt
        case _ => 0
      }

    AlfuCache(maxSizeKiloBytes, weighFn = Some(cacheWeight))
  }

  protected lazy val bucketScanner = new NativeBucketScanner()

  private def mapSingleSegment(segmentToAgglomerate: DatasetArray, segmentId: Long)(implicit ec: ExecutionContext,
                                                                                    tc: TokenContext): Fox[Long] =
    for {
      asMultiArray <- segmentToAgglomerate.readAsMultiArray(offset = segmentId, shape = 1)
    } yield asMultiArray.getLong(0)

  private def openZarrArrayCached(agglomerateFileAttachment: LayerAttachment,
                                  zarrArrayName: String)(implicit ec: ExecutionContext, tc: TokenContext) =
    openArraysCache.getOrLoad((agglomerateFileAttachment, zarrArrayName),
                              _ => openZarrArray(agglomerateFileAttachment, zarrArrayName))

  private def openZarrArray(agglomerateFileAttachment: LayerAttachment,
                            zarrArrayName: String)(implicit ec: ExecutionContext, tc: TokenContext): Fox[DatasetArray] =
    for {
      groupVaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(agglomerateFileAttachment.path, None))
      segmentToAgglomeratePath = groupVaultPath / zarrArrayName
      zarrArray <- Zarr3Array.open(segmentToAgglomeratePath,
                                   DataSourceId("zarr", "test"),
                                   "layer",
                                   None,
                                   None,
                                   None,
                                   sharedChunkContentsCache)
    } yield zarrArray

  def applyAgglomerate(agglomerateFileAttachment: LayerAttachment, elementClass: ElementClass.Value)(
      data: Array[Byte])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] = {

    def convertToAgglomerate(segmentIds: Array[Long],
                             relevantAgglomerateMap: Map[Long, Long],
                             bytesPerElement: Int,
                             putToBufferFunction: (ByteBuffer, Long) => ByteBuffer): Array[Byte] = {
      val agglomerateIds = segmentIds.map(relevantAgglomerateMap)
      agglomerateIds
        .foldLeft(ByteBuffer.allocate(bytesPerElement * segmentIds.length).order(ByteOrder.LITTLE_ENDIAN))(
          putToBufferFunction)
        .array
    }

    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val distinctSegmentIds =
      bucketScanner.collectSegmentIds(data, bytesPerElement, isSigned = false, skipZeroes = false)

    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileAttachment, "segment_to_agglomerate")
      relevantAgglomerateMap: Map[Long, Long] <- Fox
        .serialCombined(distinctSegmentIds) { segmentId =>
          mapSingleSegment(segmentToAgglomerate, segmentId).map((segmentId, _))
        }
        .map(_.toMap)
      mappedBytes: Array[Byte] = convertData(data, elementClass) match {
        case data: Array[Byte] =>
          val longBuffer = LongBuffer.allocate(data.length)
          data.foreach(e => longBuffer.put(uByteToLong(e)))
          convertToAgglomerate(longBuffer.array, relevantAgglomerateMap, bytesPerElement, putByte)
        case data: Array[Short] =>
          val longBuffer = LongBuffer.allocate(data.length)
          data.foreach(e => longBuffer.put(uShortToLong(e)))
          convertToAgglomerate(longBuffer.array, relevantAgglomerateMap, bytesPerElement, putShort)
        case data: Array[Int] =>
          val longBuffer = LongBuffer.allocate(data.length)
          data.foreach(e => longBuffer.put(uIntToLong(e)))
          convertToAgglomerate(longBuffer.array, relevantAgglomerateMap, bytesPerElement, putInt)
        case data: Array[Long] => convertToAgglomerate(data, relevantAgglomerateMap, bytesPerElement, putLong)
        case _                 => data
      }
    } yield mappedBytes
  }

  def generateSkeleton(agglomerateFileAttachment: LayerAttachment,
                       agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[SkeletonTracing] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments_offsets")
      agglomerateToEdgesOffsets <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_edges_offsets")

      positionsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      edgesRange: MultiArray <- agglomerateToEdgesOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      nodeCount = positionsRange.getLong(1) - positionsRange.getLong(0)
      edgeCount = edgesRange.getLong(1) - edgesRange.getLong(0)
      edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
      _ <- Fox.fromBool(nodeCount <= edgeLimit) ?~> s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)"
      _ <- Fox.fromBool(edgeCount <= edgeLimit) ?~> s"Agglomerate has too many edges ($edgeCount > $edgeLimit)"
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_positions")
      positions <- agglomerateToPositions.readAsMultiArray(offset = Array(positionsRange.getLong(0), 0),
                                                           shape = Array(nodeCount.toInt, 3))
      agglomerateToEdges <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_edges")
      edges: MultiArray <- agglomerateToEdges.readAsMultiArray(offset = Array(edgesRange.getLong(0), 0),
                                                               shape = Array(edgeCount.toInt, 2))
      nodeIdStartAtOneOffset = 1

      // TODO use multiarray index iterators?
      nodes = (0 until nodeCount.toInt).map { nodeIdx =>
        NodeDefaults.createInstance.copy(
          id = nodeIdx + nodeIdStartAtOneOffset,
          position = Vec3IntProto(
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 0))),
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 1))),
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 2)))
          )
        )
      }

      skeletonEdges = (0 until edges.getShape()(0)).map { edgeIdx =>
        Edge(
          source = edges.getInt(edges.getIndex.set(Array(edgeIdx, 0))) + nodeIdStartAtOneOffset,
          target = edges.getInt(edges.getIndex.set(Array(edgeIdx, 1))) + nodeIdStartAtOneOffset
        )
      }

      trees = Seq(
        Tree(
          treeId = math.abs(agglomerateId.toInt), // used only to deterministically select tree color
          createdTimestamp = System.currentTimeMillis(),
          // unsafeWrapArray is fine, because the underlying arrays are never mutated
          nodes = nodes,
          edges = skeletonEdges,
          name = s"agglomerate $agglomerateId (${agglomerateFileAttachment.name})",
          `type` = Some(TreeTypeProto.AGGLOMERATE)
        ))

      skeleton = SkeletonTracingDefaults.createInstance.copy(trees = trees)
    } yield skeleton

  def largestAgglomerateId(agglomerateFileAttachment: LayerAttachment)(implicit ec: ExecutionContext,
                                                                       tc: TokenContext): Fox[Long] =
    for {
      array <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments_offsets")
      shape <- array.datasetShape.toFox ?~> "Could not determine array shape"
      shapeFirstElement <- tryo(shape(0)).toFox
    } yield shapeFirstElement

  def generateAgglomerateGraph(agglomerateFileAttachment: LayerAttachment, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AgglomerateGraph] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments_offsets")
      agglomerateToEdgesOffsets <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_edges_offsets")

      positionsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      edgesRange: MultiArray <- agglomerateToEdgesOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      nodeCount = positionsRange.getLong(1) - positionsRange.getLong(0)
      edgeCount = edgesRange.getLong(1) - edgesRange.getLong(0)
      edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
      _ <- Fox.fromBool(nodeCount <= edgeLimit) ?~> s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)"
      _ <- Fox.fromBool(edgeCount <= edgeLimit) ?~> s"Agglomerate has too many edges ($edgeCount > $edgeLimit)"
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_positions")
      positions: MultiArray <- agglomerateToPositions.readAsMultiArray(offset = Array(positionsRange.getLong(0), 0),
                                                                       shape = Array(nodeCount.toInt, 3))
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments")
      segmentIdsMA: MultiArray <- agglomerateToSegments.readAsMultiArray(offset = positionsRange.getInt(0),
                                                                         shape = nodeCount.toInt)
      segmentIds: Array[Long] <- MultiArrayUtils.toLongArray(segmentIdsMA).toFox
      agglomerateToEdges <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_edges")
      edges: MultiArray <- agglomerateToEdges.readAsMultiArray(offset = Array(edgesRange.getLong(0), 0),
                                                               shape = Array(edgeCount.toInt, 2))
      agglomerateToAffinities <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_affinities")
      affinities: MultiArray <- agglomerateToAffinities.readAsMultiArray(offset = edgesRange.getLong(0),
                                                                         shape = edgeCount.toInt)

      agglomerateGraph = AgglomerateGraph(
        // unsafeWrapArray is fine, because the underlying arrays are never mutated
        segments = ArraySeq.unsafeWrapArray(segmentIds),
        edges = (0 until edges.getShape()(0)).map { edgeIdx: Int =>
          AgglomerateEdge(
            source = segmentIds(edges.getInt(edges.getIndex.set(Array(edgeIdx, 0)))),
            target = segmentIds(edges.getInt(edges.getIndex.set(Array(edgeIdx, 1))))
          )
        },
        positions = (0 until nodeCount.toInt).map { nodeIdx: Int =>
          Vec3IntProto(
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 0))),
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 1))),
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 2)))
          )
        },
        affinities = ArraySeq.unsafeWrapArray(affinities.getStorage.asInstanceOf[Array[Float]])
      )
    } yield agglomerateGraph

  def segmentIdsForAgglomerateId(agglomerateFileAttachment: LayerAttachment,
                                 agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments_offsets")
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments")
      segmentRange <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      segmentCount = segmentRange.getLong(1) - segmentRange.getLong(0)
      segmentIds <- if (segmentCount == 0)
        Fox.successful(Array.empty[Long])
      else
        agglomerateToSegments
          .readAsMultiArray(offset = segmentRange.getLong(0), shape = segmentCount.toInt)
          .flatMap(MultiArrayUtils.toLongArray(_).toFox)
    } yield segmentIds.toSeq

  def agglomerateIdsForSegmentIds(agglomerateFileAttachment: LayerAttachment, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileAttachment, "segment_to_agglomerate")
      agglomerateIds <- Fox.serialCombined(segmentIds) { segmentId =>
        mapSingleSegment(segmentToAgglomerate, segmentId)
      }
    } yield agglomerateIds

  def positionForSegmentId(agglomerateFileAttachment: LayerAttachment,
                           segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileAttachment, "segment_to_agglomerate")
      agglomerateId <- mapSingleSegment(segmentToAgglomerate, segmentId)
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments_offsets")
      segmentsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_segments")
      segmentIndex <- binarySearchForSegment(segmentsRange.getLong(0),
                                             segmentsRange.getLong(1),
                                             segmentId,
                                             agglomerateToSegments)
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileAttachment, "agglomerate_to_positions")
      position <- agglomerateToPositions.readAsMultiArray(offset = Array(segmentIndex, 0), shape = Array(3, 1))
    } yield Vec3Int(position.getInt(0), position.getInt(1), position.getInt(2))

  private def binarySearchForSegment(
      rangeStart: Long,
      rangeEnd: Long,
      segmentId: Long,
      agglomerateToSegments: DatasetArray)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    if (rangeStart > rangeEnd) Fox.failure("Could not find segmentId in agglomerate file")
    else {
      val middle = rangeStart + (rangeEnd - rangeStart) / 2
      for {
        segmentIdAtMiddleMA <- agglomerateToSegments.readAsMultiArray(offset = middle, shape = 1)
        segmentIdAdMiddleArray: Array[Long] <- MultiArrayUtils.toLongArray(segmentIdAtMiddleMA).toFox
        segmentIdAtMiddle = segmentIdAdMiddleArray(0)
        segmentIndex <- if (segmentIdAtMiddle == segmentId)
          Fox.successful(middle)
        else if (segmentIdAtMiddle < segmentId) {
          binarySearchForSegment(middle + 1L, rangeEnd, segmentId, agglomerateToSegments)
        } else binarySearchForSegment(rangeStart, middle - 1L, segmentId, agglomerateToSegments)
      } yield segmentIndex
    }
}
