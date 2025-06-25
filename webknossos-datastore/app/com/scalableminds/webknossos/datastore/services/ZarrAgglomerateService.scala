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
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.storage.{AgglomerateFileKey, DataVaultService, RemoteSourceDescriptor}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import ucar.ma2.{Array => MultiArray}

import java.nio.{ByteBuffer, ByteOrder, LongBuffer}
import scala.collection.compat.immutable.ArraySeq
import scala.concurrent.ExecutionContext

class ZarrAgglomerateService(config: DataStoreConfig,
                             dataVaultService: DataVaultService,
                             sharedChunkContentsCache: AlfuCache[String, MultiArray])
    extends DataConverter
    with LazyLogging {

  private lazy val openArraysCache = AlfuCache[(AgglomerateFileKey, String), DatasetArray]()

  def clearCache(predicate: ((AgglomerateFileKey, String)) => Boolean): Int =
    openArraysCache.clear(predicate)

  protected lazy val bucketScanner = new NativeBucketScanner()

  private val keySegmentToAgglomerate = "segment_to_agglomerate"
  private val keyAgglomerateToSegmentsOffsets = "agglomerate_to_segments_offsets"
  private val keyAgglomerateToSegments = "agglomerate_to_segments"
  private val keyAgglomerateToPositions = "agglomerate_to_positions"
  private val keyAgglomerateToEdges = "agglomerate_to_edges"
  private val keyAgglomerateToEdgesOffsets = "agglomerate_to_edges_offsets"
  private val keyAgglomerateToAffinities = "agglomerate_to_affinities"

  private def mapSingleSegment(segmentToAgglomerate: DatasetArray, segmentId: Long)(implicit ec: ExecutionContext,
                                                                                    tc: TokenContext): Fox[Long] =
    for {
      asMultiArray <- segmentToAgglomerate.readAsMultiArray(offset = segmentId, shape = 1)
    } yield asMultiArray.getLong(0)

  private def openZarrArrayCached(agglomerateFileKey: AgglomerateFileKey,
                                  zarrArrayName: String)(implicit ec: ExecutionContext, tc: TokenContext) =
    openArraysCache.getOrLoad((agglomerateFileKey, zarrArrayName),
                              _ => openZarrArray(agglomerateFileKey, zarrArrayName))

  private def openZarrArray(agglomerateFileKey: AgglomerateFileKey,
                            zarrArrayName: String)(implicit ec: ExecutionContext, tc: TokenContext): Fox[DatasetArray] =
    for {
      groupVaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(agglomerateFileKey.attachment.path, None))
      segmentToAgglomeratePath = groupVaultPath / zarrArrayName
      zarrArray <- Zarr3Array.open(segmentToAgglomeratePath,
                                   DataSourceId("dummy", "unused"),
                                   "layer",
                                   None,
                                   None,
                                   None,
                                   sharedChunkContentsCache)
    } yield zarrArray

  def applyAgglomerate(agglomerateFileKey: AgglomerateFileKey, elementClass: ElementClass.Value)(
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
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileKey, keySegmentToAgglomerate)
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

  def generateSkeleton(agglomerateFileKey: AgglomerateFileKey,
                       agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[SkeletonTracing] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegmentsOffsets)
      agglomerateToEdgesOffsets <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToEdgesOffsets)

      positionsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      nodeCount <- tryo(positionsRange.getLong(1) - positionsRange.getLong(0)).toFox
      edgesRange: MultiArray <- agglomerateToEdgesOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      edgesOffset <- tryo(edgesRange.getLong(0)).toFox
      edgeCount <- tryo(edgesRange.getLong(1) - edgesOffset).toFox
      edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
      _ <- Fox.fromBool(nodeCount <= edgeLimit) ?~> s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)"
      _ <- Fox.fromBool(edgeCount <= edgeLimit) ?~> s"Agglomerate has too many edges ($edgeCount > $edgeLimit)"
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToPositions)
      positions <- agglomerateToPositions.readAsMultiArray(offset = Array(positionsRange.getLong(0), 0),
                                                           shape = Array(nodeCount.toInt, 3))
      agglomerateToEdges <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToEdges)
      edges: MultiArray <- agglomerateToEdges.readAsMultiArray(offset = Array(edgesOffset, 0),
                                                               shape = Array(edgeCount.toInt, 2))
      nodeIdStartAtOneOffset = 1

      nodes <- tryo {
        (0 until nodeCount.toInt).map { nodeIdx =>
          NodeDefaults.createInstance.copy(
            id = nodeIdx + nodeIdStartAtOneOffset,
            position = Vec3IntProto(
              positions.getInt(positions.getIndex.set(Array(nodeIdx, 0))),
              positions.getInt(positions.getIndex.set(Array(nodeIdx, 1))),
              positions.getInt(positions.getIndex.set(Array(nodeIdx, 2)))
            )
          )
        }
      }.toFox

      skeletonEdges <- tryo {
        (0 until edges.getShape()(0)).map { edgeIdx =>
          Edge(
            source = edges.getInt(edges.getIndex.set(Array(edgeIdx, 0))) + nodeIdStartAtOneOffset,
            target = edges.getInt(edges.getIndex.set(Array(edgeIdx, 1))) + nodeIdStartAtOneOffset
          )
        }
      }.toFox

      trees = Seq(
        Tree(
          treeId = math.abs(agglomerateId.toInt), // used only to deterministically select tree color
          createdTimestamp = System.currentTimeMillis(),
          // unsafeWrapArray is fine, because the underlying arrays are never mutated
          nodes = nodes,
          edges = skeletonEdges,
          name = s"agglomerate $agglomerateId (${agglomerateFileKey.attachment.name})",
          `type` = Some(TreeTypeProto.AGGLOMERATE)
        ))

      skeleton = SkeletonTracingDefaults.createInstance.copy(trees = trees)
    } yield skeleton

  def largestAgglomerateId(agglomerateFileKey: AgglomerateFileKey)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[Long] =
    for {
      array <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegmentsOffsets)
      shape <- array.datasetShape.toFox ?~> "Could not determine array shape"
      shapeFirstElement <- tryo(shape(0)).toFox
    } yield shapeFirstElement

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AgglomerateGraph] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegmentsOffsets)
      agglomerateToEdgesOffsets <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToEdgesOffsets)

      positionsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      edgesRange: MultiArray <- agglomerateToEdgesOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      nodeCount <- tryo(positionsRange.getLong(1) - positionsRange.getLong(0)).toFox
      edgesOffset <- tryo(edgesRange.getLong(0)).toFox
      edgeCount <- tryo(edgesRange.getLong(1) - edgesOffset).toFox
      edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
      _ <- Fox.fromBool(nodeCount <= edgeLimit) ?~> s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)"
      _ <- Fox.fromBool(edgeCount <= edgeLimit) ?~> s"Agglomerate has too many edges ($edgeCount > $edgeLimit)"
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToPositions)
      positions: MultiArray <- agglomerateToPositions.readAsMultiArray(offset = Array(positionsRange.getLong(0), 0),
                                                                       shape = Array(nodeCount.toInt, 3))
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegments)
      segmentIdsMA: MultiArray <- agglomerateToSegments.readAsMultiArray(offset = positionsRange.getInt(0),
                                                                         shape = nodeCount.toInt)
      segmentIds: Array[Long] <- MultiArrayUtils.toLongArray(segmentIdsMA).toFox
      agglomerateToEdges <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToEdges)
      edges: MultiArray <- agglomerateToEdges.readAsMultiArray(offset = Array(edgesOffset, 0),
                                                               shape = Array(edgeCount.toInt, 2))
      agglomerateToAffinities <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToAffinities)
      affinities: MultiArray <- agglomerateToAffinities.readAsMultiArray(offset = edgesOffset, shape = edgeCount.toInt)

      agglomerateGraph <- tryo {
        AgglomerateGraph(
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
      }.toFox
    } yield agglomerateGraph

  def segmentIdsForAgglomerateId(agglomerateFileKey: AgglomerateFileKey,
                                 agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegmentsOffsets)
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegments)
      segmentRange <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      segmentOffset <- tryo(segmentRange.getLong(0)).toFox
      segmentCount <- tryo(segmentRange.getLong(1) - segmentOffset).toFox
      segmentIds <- if (segmentCount == 0)
        Fox.successful(Array.empty[Long])
      else
        agglomerateToSegments
          .readAsMultiArray(offset = segmentOffset, shape = segmentCount.toInt)
          .flatMap(MultiArrayUtils.toLongArray(_).toFox)
    } yield segmentIds.toSeq

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileKey, keySegmentToAgglomerate)
      agglomerateIds <- Fox.serialCombined(segmentIds) { segmentId =>
        mapSingleSegment(segmentToAgglomerate, segmentId)
      }
    } yield agglomerateIds

  def positionForSegmentId(agglomerateFileKey: AgglomerateFileKey, segmentId: Long)(implicit ec: ExecutionContext,
                                                                                    tc: TokenContext): Fox[Vec3Int] =
    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileKey, keySegmentToAgglomerate)
      agglomerateId <- mapSingleSegment(segmentToAgglomerate, segmentId)
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegmentsOffsets)
      segmentsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = agglomerateId, shape = 2)
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToSegments)
      segmentIndex <- binarySearchForSegment(segmentsRange.getLong(0),
                                             segmentsRange.getLong(1),
                                             segmentId,
                                             agglomerateToSegments)
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileKey, keyAgglomerateToPositions)
      position <- agglomerateToPositions.readAsMultiArray(offset = Array(segmentIndex, 0), shape = Array(1, 3))
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
        segmentIdAtMiddle <- tryo(segmentIdAdMiddleArray(0)).toFox
        segmentIndex <- if (segmentIdAtMiddle == segmentId)
          Fox.successful(middle)
        else if (segmentIdAtMiddle < segmentId) {
          binarySearchForSegment(middle + 1L, rangeEnd, segmentId, agglomerateToSegments)
        } else binarySearchForSegment(rangeStart, middle - 1L, segmentId, agglomerateToSegments)
      } yield segmentIndex
    }
}
