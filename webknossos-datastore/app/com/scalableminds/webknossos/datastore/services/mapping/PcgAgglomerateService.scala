package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.Msg
import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.SkeletonTracing.{
  Edge,
  SkeletonTracing,
  Tree,
  TreeAgglomerateInfoProto,
  TreeTypeProto
}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services.BinaryDataServiceHolder
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.box.{Failure, Full}
import play.api.libs.json.{JsError, JsObject, JsSuccess, Json, Reads}

import java.nio.{ByteBuffer, ByteOrder}
import com.scalableminds.util.objectid.ObjectId

import javax.inject.{Inject, Provider}
import scala.collection.compat.immutable.ArraySeq
import scala.collection.mutable
import scala.concurrent.ExecutionContext

/** Serves agglomerate mappings from a PyChunkedGraph (PCG) instance over HTTP, as a third `LayerAttachmentDataformat`
  * next to hdf5 and zarr3. A PCG instance works as a tree hierarchy. Supervoxels are leafs and roots are agglomerate
  * ids.
  *
  * The attachment `path` is the base URL of a PCG table, e.g. `http://localhost:4000/segmentation/api/v1/table/big`;
  * endpoints are appended to it.
  *
  * Positions are the awkward part: PCG stores topology over an immutable volume and keeps no coordinates for its own
  * sake. There are two ways to get one, and this service uses both:
  *
  *   - If the graph was ingested with `store_positions`, PCG has a representative voxel per supervoxel and
  *     `POST /node_positions` returns it. One point read.
  *   - Otherwise, decode the chunk out of the supervoxel id and read that chunk of the volume until the id turns up.
  *     Exact, but a production chunk is hundreds of buckets. See `positionForSegmentId`.
  *
  * `generateAgglomerateGraph` and `generateTree` only take the first route, so nodes of a graph ingested without
  * positions stay at the origin.
  *
  * Root lookups have the same two-route shape: `POST /table/<id>/chunk_root_mapping_binary/<chunk id>` answers a whole
  * PCG chunk's supervoxel -> root mapping in one request, which is the difference between one request and one per
  * supervoxel while browsing. Both `store_positions` and chunk-root-mapping are our own additions, not upstream PCG
  * routes, so a stock PCG instance still works through this service -- just one supervoxel at a time. See
  * `rootsForSupervoxels`.
  *
  * PCG has no largest agglomerate id -- ids are chunk-encoded and sparse, so there is nothing to allocate from and
  * `largestAgglomerateId` fails.
  */
object PcgAgglomerateService {

  val chunkCacheSizeMultiplier: Int = 8
}

class PcgAgglomerateService @Inject() (
    config: DataStoreConfig,
    rpc: RPC,
    // A Provider breaks a dependency cycle: BinaryDataServiceHolder needs AgglomerateService
    // to apply mappings while reading, and this service is one of its branches. Nothing is
    // resolved until the first position lookup, when both sides exist.
    binaryDataServiceHolderProvider: Provider[BinaryDataServiceHolder]
) extends LazyLogging {

  private lazy val bucketScanner = new NativeBucketScanner()

  // supervoxel -> root (agglomerate id) for fallback /roots_binary route results.
  private lazy val supervoxelToAgglomerateFallbackCache: AlfuCache[(AgglomerateFileKey, Long), Long] =
    AlfuCache(maxCapacity = config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries)

  // supervoxel -> root (agglomerate id) for wk optimized /chunk_root_mapping_binary route results.
  private lazy val chunkToAgglomerateMappingsCache =
    new ChunkMappingCache(
      config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries.toLong * PcgAgglomerateService.chunkCacheSizeMultiplier
    )

  // Limit at which amount of chunks per request to stop the chunk based mapping optimization. Happens when the user zooms out very far.
  private val chunkPrefetchLimit = 32

  // Graphs whose PCG does not support our added chunk-mapping route. -> chunkToAgglomerateMappingsCache cant be used.
  private lazy val graphsWithoutChunkMapping: java.util.Set[AgglomerateFileKey] =
    java.util.concurrent.ConcurrentHashMap.newKeySet[AgglomerateFileKey]()

  // root -> supervoxels cache.
  private lazy val leavesCache: AlfuCache[(AgglomerateFileKey, Long), Seq[Long]] = AlfuCache()

  private val bucketLength = DataLayer.bucketLength

  private val scanBatchSize = 8

  /** Ceiling on buckets read for one position lookup. 512 covers a 512x512x64 chunk, the largest a production CAVE
    * graph is likely to use.
    */
  private val scanBucketLimit = 512

  // Node-id layout and voxel grid of the graph. Immutable for a graph's lifetime.
  private lazy val graphInfoCache: AlfuCache[AgglomerateFileKey, PcgGraphInfo] = AlfuCache(maxCapacity = 100)

  private def graphInfo(agglomerateFileKey: AgglomerateFileKey)(using ec: ExecutionContext): Fox[PcgGraphInfo] =
    graphInfoCache.getOrLoad(
      agglomerateFileKey,
      key => rpc(infoUrl(key)).silent.getWithJsonResponse[PcgGraphInfo]
    )

  private def baseUrl(agglomerateFileKey: AgglomerateFileKey): String =
    agglomerateFileKey.attachment.path.toString.stripSuffix("/")

  // PCGs info url is not version, thus removing this part from the URL here.
  private def infoUrl(agglomerateFileKey: AgglomerateFileKey): String =
    s"${baseUrl(agglomerateFileKey).replace("/api/v1/table/", "/table/")}/info"

  private def postRootsBinary(agglomerateFileKey: AgglomerateFileKey, supervoxelIds: Array[Long])(using
      ec: ExecutionContext
  ): Fox[Array[Long]] = {
    val body = ByteBuffer.allocate(supervoxelIds.length * 8).order(ByteOrder.LITTLE_ENDIAN)
    supervoxelIds.foreach(body.putLong)
    for {
      responseBytes <- rpc(s"${baseUrl(agglomerateFileKey)}/roots_binary").silent
        .addHttpHeader("Content-Type", "application/octet-stream")
        .postBytesWithBytesResponse(body.array)
      roots <- tryo(decodeUint64Array(responseBytes)).toFox
      _ <- Fox.fromBool(roots.length == supervoxelIds.length) ?~>
        Msg.AgglomerateFile.Pcg.rootCountMismatch(roots.length, supervoxelIds.length)
    } yield roots
  }

  private def decodeUint64Array(bytes: Array[Byte]): Array[Long] = {
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
    val result = new Array[Long](buffer.remaining())
    buffer.get(result)
    result
  }

  private def agglomerateIdsForSupervoxels(agglomerateFileKey: AgglomerateFileKey, supervoxelIds: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Seq[Long]] = {
    val distinctSupervoxelIds = supervoxelIds.iterator.distinct.filter(_ != 0L).toSeq
    for {
      viaChunks <- agglomerateIdsForSupervoxelsViaChunks(agglomerateFileKey, distinctSupervoxelIds)
      lookup <- viaChunks match {
        case Some(fromChunks) =>
          // A supervoxel its own chunk does not account for should not happen, but asking for it by id is cheap and
          // keeps a surprise from turning into a black voxel.
          val unaccounted = distinctSupervoxelIds.filterNot(fromChunks.contains)
          if (unaccounted.isEmpty) Fox.successful(fromChunks)
          else agglomerateIdsForSupervoxelsViaFallback(agglomerateFileKey, unaccounted).map(fromChunks ++ _)
        case None => agglomerateIdsForSupervoxelsViaFallback(agglomerateFileKey, distinctSupervoxelIds)
      }
    } yield supervoxelIds.map(id => if (id == 0L) 0L else lookup.getOrElse(id, 0L))
  }

  private def agglomerateIdsForSupervoxelsViaFallback(agglomerateFileKey: AgglomerateFileKey, distinct: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Map[Long, Long]] = {
    val cached: Map[Long, Long] =
      distinct.iterator
        .flatMap(id => supervoxelToAgglomerateFallbackCache.get((agglomerateFileKey, id)).map(id -> _))
        .toMap
    val missing: Array[Long] = distinct.iterator.filterNot(cached.contains).toArray
    for {
      fetched <-
        if (missing.isEmpty) Fox.successful(Array.empty[Long])
        else postRootsBinary(agglomerateFileKey, missing)
      _ = missing.indices.foreach(i =>
        supervoxelToAgglomerateFallbackCache.put((agglomerateFileKey, missing(i)), fetched(i))
      )
      // Resolve from a local map, not from the cache: one request larger than maxEntries would
      // otherwise evict its own results before they are used.
    } yield cached ++ missing.indices.iterator.map(i => missing(i) -> fetched(i))
  }

  /** The chunk path: fetch each chunk these ids fall into, once, and answer all of them from it.
    *
    * `None` means "not this way, ask per supervoxel": the graph's PCG has no chunk-mapping route, the id layout is not
    * known, or the request spans more chunks than prefetching them is worth. Callers must be able to take that answer,
    * which is why this is never the only path.
    */
  private def agglomerateIdsForSupervoxelsViaChunks(
      agglomerateFileKey: AgglomerateFileKey,
      distinctSupervoxelIds: Seq[Long]
  )(using
      ec: ExecutionContext
  ): Fox[Option[Map[Long, Long]]] =
    if (distinctSupervoxelIds.isEmpty || graphsWithoutChunkMapping.contains(agglomerateFileKey)) Fox.successful(None)
    else
      for {
        infoBox <- graphInfo(agglomerateFileKey).shiftBox
        chunkIdsOpt = infoBox.toOption
          .flatMap(info => tryo(distinctSupervoxelIds.iterator.map(chunkIdOf(info, _)).distinct.toSeq).toOption)
        result <- chunkIdsOpt match {
          case Some(chunkIds) if chunkIds.length <= chunkPrefetchLimit =>
            for {
              chunkMappingsBox <- Fox.combined(chunkIds.map(mappingForWholeChunk(agglomerateFileKey, _))).shiftBox
              supervoxelIdToAgglomerateIdMapOpt = chunkMappingsBox match {
                case Full(mappings) =>
                  Some(
                    distinctSupervoxelIds.iterator.flatMap(id => rootOfIn(mappings, id).map(root => id -> root)).toMap
                  )
                case _ => None
              }
            } yield supervoxelIdToAgglomerateIdMapOpt
          // Don't answer when a single user request would cause a prefetch of more than chunkPrefetchLimit chunks.
          // In this case the user has zoomed out far and only a few of the actually fetched mapping info will be actually used.
          // This prevents blowing up the chunkToAgglomerateMappingsCache.
          case _ => Fox.successful(None)
        }
      } yield result

  private def rootOfIn(mappings: Seq[PcgChunkMapping], supervoxelId: Long): Option[Long] =
    mappings.iterator.flatMap(_.rootOf(supervoxelId)).nextOption()

  private def mappingForWholeChunk(agglomerateFileKey: AgglomerateFileKey, chunkId: Long)(using
      ec: ExecutionContext
  ): Fox[PcgChunkMapping] =
    chunkToAgglomerateMappingsCache.get((agglomerateFileKey, chunkId)) match {
      case Some(mapping) => Fox.successful(mapping)
      case None          =>
        for {
          mappingBox <- fetchMappingForWholeChunk(agglomerateFileKey, chunkId).shiftBox
          mapping <- mappingBox match {
            case Full(mapping) =>
              chunkToAgglomerateMappingsCache.put((agglomerateFileKey, chunkId), mapping)
              Fox.successful(mapping)
            case failure: Failure =>
              if (looksLikeMissingRoute(failure)) {
                if (graphsWithoutChunkMapping.add(agglomerateFileKey))
                  logger.info(
                    s"${baseUrl(agglomerateFileKey)} serves no chunk mappings; reading it one supervoxel at a time"
                  )
              }
              failure.toFox
            case _ => Fox.empty
          }
        } yield mapping
    }

  private def looksLikeMissingRoute(failure: Failure): Boolean =
    failure.msg.contains("Response: 404") || failure.msg.contains("Response: 405")

  /*
   * The optimized route replying with all supervoxel -> root / agglomerate id mapping of a chunk.
   */
  private def fetchMappingForWholeChunk(agglomerateFileKey: AgglomerateFileKey, chunkId: Long)(using
      ec: ExecutionContext
  ): Fox[PcgChunkMapping] = {
    val chunk = java.lang.Long.toUnsignedString(chunkId)
    for {
      responseBytes <- rpc(
        s"${baseUrl(agglomerateFileKey)}/chunk_root_mapping_binary/$chunk"
      ).silentEvenOnFailure.getWithBytesResponse
      pairs <- tryo(decodeUint64Array(responseBytes)).toFox
      _ <- Fox.fromBool(pairs.length % 2 == 0) ?~>
        Msg.AgglomerateFile.Pcg.chunkMappingNotPaired(pairs.length, chunk)
      mapping <- tryo(PcgChunkMapping.fromInterleaved(pairs)).toFox
    } yield mapping
  }

  /** The chunk a supervoxel belongs to, which is its own id with the counter bits cleared -- PCG's `get_chunk_id`. The
    * layout is `[layer | x | y | z | counter]`, so everything above the counter names the chunk.
    */
  private def chunkIdOf(graphInfo: PcgGraphInfo, supervoxelId: Long): Long = {
    val layer = supervoxelId >>> (64 - graphInfo.layerIdBits)
    val bitsPerDim = graphInfo.bitsPerDim.getOrElse(
      layer.toInt,
      throw new Exception(Msg.AgglomerateFile.Pcg.noChunkBitWidth(layer, supervoxelId))
    )
    val counterBits = 64 - graphInfo.layerIdBits - 3 * bitsPerDim
    (supervoxelId >>> counterBits) << counterBits
  }

  def applyAgglomerate(agglomerateFileKey: AgglomerateFileKey, elementClass: ElementClass.Value)(
      data: Array[Byte]
  )(using ec: ExecutionContext): Fox[Array[Byte]] = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val isSigned = ElementClass.isSigned(elementClass)
    val distinctSegmentIds = bucketScanner.collectSegmentIds(data, bytesPerElement, isSigned, skipZeroes = false)
    for {
      agglomerateIds <- agglomerateIdsForSupervoxels(agglomerateFileKey, ArraySeq.unsafeWrapArray(distinctSegmentIds))
      mappedBytes = bucketScanner.applySegmentIdMapping(
        data,
        bytesPerElement,
        isSigned,
        distinctSegmentIds,
        agglomerateIds.toArray
      )
    } yield mappedBytes
  }

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Seq[Long]] = agglomerateIdsForSupervoxels(agglomerateFileKey, segmentIds)

  def segmentIdsForAgglomerateId(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext
  ): Fox[Seq[Long]] =
    leavesCache.getOrLoad(
      (agglomerateFileKey, agglomerateId),
      _ =>
        rpc(s"${baseUrl(agglomerateFileKey)}/node/$agglomerateId/leaves").silent
          .getWithJsonResponse[PcgLeaves]
          .map(_.leafIds)
    )

  /** PCG stores a cross-chunk edge in both chunks it touches, so `subgraph` returns it twice, once as (a, b) and once
    * as (b, a). Here we deduplicate this.
    */
  private def foldEdgeDirections(response: PcgSubgraph): PcgSubgraph = {
    val seen = mutable.HashSet[(Long, Long)]()
    val kept = response.edges.zip(response.affinities).filter { case (edge, _) =>
      seen.add((math.min(edge(0), edge(1)), math.max(edge(0), edge(1))))
    }
    PcgSubgraph(kept.map(_._1), kept.map(_._2))
  }

  private def subgraphForAgglomerateId(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long, edgeLimit: Int)(
      using ec: ExecutionContext
  ): Fox[PcgSubgraph] =
    for {
      response <- rpc(s"${baseUrl(agglomerateFileKey)}/node/$agglomerateId/subgraph").silent
        .getWithJsonResponse[PcgSubgraph]
      folded <- tryo(foldEdgeDirections(response)).toFox
      _ <- Fox.fromBool(folded.edges.length <= edgeLimit) ?~>
        Msg.AgglomerateGraph.tooManyEdges(folded.edges.length, edgeLimit)
    } yield folded

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext
  ): Fox[AgglomerateGraph] =
    for {
      segmentIds <- segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
      edgeLimit = config.Datastore.AgglomerateGraph.maxEdges
      _ <- Fox.fromBool(segmentIds.length <= edgeLimit) ?~>
        Msg.AgglomerateGraph.tooManyNodes(segmentIds.length, edgeLimit)
      response <- subgraphForAgglomerateId(agglomerateFileKey, agglomerateId, edgeLimit)
      edges <- tryo(response.edges.map(e => AgglomerateEdge(source = e(0), target = e(1)))).toFox
      // One request for the whole agglomerate. A supervoxel PCG has no position for stays
      // at the origin; scanning the volume for each of them would cost a read per node.
      positions <- storedPositions(agglomerateFileKey, segmentIds)
    } yield AgglomerateGraph(
      segments = segmentIds,
      edges = edges,
      positions = segmentIds.map(positionProtoFromMap(positions, _)),
      affinities = response.affinities
    )

  def generateTree(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext
  ): Fox[SkeletonTracing] =
    for {
      segmentIds <- segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
      edgeLimit = config.Datastore.AgglomerateTree.maxEdges
      _ <- Fox.fromBool(segmentIds.length <= edgeLimit) ?~>
        Msg.AgglomerateGraph.tooManyNodes(segmentIds.length, edgeLimit)
      response <- subgraphForAgglomerateId(agglomerateFileKey, agglomerateId, edgeLimit)
      positions <- storedPositions(agglomerateFileKey, segmentIds)
      nodeIdStartAtOneOffset = 1
      // PCG's subgraph edges name supervoxels; skeleton edges name node indices.
      indexBySegmentId = segmentIds.iterator.zipWithIndex.map { case (id, idx) =>
        id -> (idx + nodeIdStartAtOneOffset)
      }.toMap
      nodes = segmentIds.indices.map { idx =>
        NodeDefaults.createInstance.copy(
          id = idx + nodeIdStartAtOneOffset,
          position = positionProtoFromMap(positions, segmentIds(idx))
        )
      }
      treeEdges <- tryo(response.edges.flatMap { e =>
        for {
          source <- indexBySegmentId.get(e(0))
          target <- indexBySegmentId.get(e(1))
        } yield Edge(source = source, target = target)
      }).toFox
    } yield SkeletonTracingDefaults.createInstance.copy(trees =
      Seq(
        Tree(
          treeId = math.abs(agglomerateId.toInt), // used only to deterministically select tree color
          createdTimestamp = System.currentTimeMillis(),
          nodes = nodes,
          edges = treeEdges,
          name = s"agglomerate $agglomerateId (${agglomerateFileKey.attachment.name})",
          `type` = Some(TreeTypeProto.AGGLOMERATE),
          agglomerateInfo =
            Some(TreeAgglomerateInfoProto(agglomerateId, None, Some(agglomerateFileKey.attachment.name)))
        )
      )
    )

  private def positionProtoFromMap(positions: Map[Long, Vec3Int], segmentId: Long): Vec3IntProto =
    positions.get(segmentId) match {
      case Some(p) => Vec3IntProto(p.x, p.y, p.z)
      case None    => Vec3IntProto(0, 0, 0)
    }

  /** Voxel coordinates PCG recorded at ingest, for whichever of these ids have one. None for segment ids which don't
    * have this info.
    */
  private def storedPositions(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Map[Long, Vec3Int]] =
    if (segmentIds.isEmpty) Fox.successful(Map.empty)
    else
      rpc(s"${baseUrl(agglomerateFileKey)}/node_positions").silentEvenOnFailure
        .postJsonWithJsonResponse[JsObject, Map[String, Seq[Int]]](Json.obj("node_ids" -> segmentIds))
        .map { raw =>
          raw.flatMap {
            case (id, Seq(x, y, z)) => id.toLongOption.map(_ -> Vec3Int(x, y, z))
            case _                  => None
          }
        }
        .orElse(Fox.successful(Map.empty[Long, Vec3Int]))

  /** A representative voxel of a supervoxel: PCG's own, if it stored one, else found by reading the volume.
    */
  def positionForSegmentId(
      agglomerateFileKey: AgglomerateFileKey,
      segmentId: Long,
      datasetId: Option[ObjectId],
      dataLayer: DataLayer
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    for {
      stored <- storedPositions(agglomerateFileKey, Seq(segmentId))
      position <- stored.get(segmentId) match {
        case Some(position) => Fox.successful(position)
        case None           => scanPositionForSegmentId(agglomerateFileKey, segmentId, datasetId, dataLayer)
      }
    } yield position

  /** Find a voxel of the supervoxel by reading the volume, for graphs where PCG stored no position.
    */
  private def scanPositionForSegmentId(
      agglomerateFileKey: AgglomerateFileKey,
      segmentId: Long,
      datasetId: Option[ObjectId],
      dataLayer: DataLayer
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    for {
      graphInfo <- graphInfo(agglomerateFileKey)
      chunkBox <- chunkBoundingBoxForSegmentId(graphInfo, segmentId).toFox
      searchBox = chunkBox.intersection(dataLayer.boundingBox).getOrElse(chunkBox)
      buckets = bucketTopLeftsIn(searchBox)
      _ <- Fox.fromBool(buckets.length <= scanBucketLimit) ?~>
        Msg.AgglomerateFile.Pcg.chunkTooLargeToScan(segmentId, buckets.length, scanBucketLimit)
      position <- scanForSegmentId(datasetId, agglomerateFileKey, dataLayer, segmentId, buckets.toList) ?~>
        Msg.AgglomerateFile.Pcg.segmentNotFoundInChunk(segmentId, chunkBox.toString)
    } yield position

  private def chunkBoundingBoxForSegmentId(graphInfo: PcgGraphInfo, segmentId: Long): Box[BoundingBox] =
    tryo {
      val layer = segmentId >>> (64 - graphInfo.layerIdBits)
      val bitsPerDim = graphInfo.bitsPerDim.getOrElse(
        layer.toInt,
        throw new Exception(Msg.AgglomerateFile.Pcg.noChunkBitWidth(layer, segmentId))
      )
      val mask = (1L << bitsPerDim) - 1L
      val xOffset = 64 - graphInfo.layerIdBits - bitsPerDim
      val chunk = Vec3Int(
        ((segmentId >>> xOffset) & mask).toInt,
        ((segmentId >>> (xOffset - bitsPerDim)) & mask).toInt,
        ((segmentId >>> (xOffset - 2 * bitsPerDim)) & mask).toInt
      )
      BoundingBox(
        Vec3Int(
          chunk.x * graphInfo.chunkSize.x + graphInfo.chunkGridOrigin.x,
          chunk.y * graphInfo.chunkSize.y + graphInfo.chunkGridOrigin.y,
          chunk.z * graphInfo.chunkSize.z + graphInfo.chunkGridOrigin.z
        ),
        graphInfo.chunkSize.x,
        graphInfo.chunkSize.y,
        graphInfo.chunkSize.z
      )
    }

  private def bucketTopLeftsIn(box: BoundingBox): Seq[Vec3Int] = {
    def aligned(v: Int): Int = Math.floorDiv(v, bucketLength) * bucketLength
    for {
      z <- aligned(box.topLeft.z) until box.bottomRight.z by bucketLength
      y <- aligned(box.topLeft.y) until box.bottomRight.y by bucketLength
      x <- aligned(box.topLeft.x) until box.bottomRight.x by bucketLength
    } yield Vec3Int(x, y, z)
  }

  private def scanForSegmentId(
      datasetId: Option[ObjectId],
      agglomerateFileKey: AgglomerateFileKey,
      dataLayer: DataLayer,
      segmentId: Long,
      buckets: List[Vec3Int]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    buckets match {
      case Nil => Fox.empty
      case _   =>
        val (batch, rest) = buckets.splitAt(scanBatchSize)
        for {
          hits <- Fox.serialCombined(batch)(topLeft =>
            findSegmentIdInBucket(datasetId, agglomerateFileKey, dataLayer, segmentId, topLeft)
          )
          position <- hits.flatten.headOption match {
            case Some(found) => Fox.successful(found)
            case None        => scanForSegmentId(datasetId, agglomerateFileKey, dataLayer, segmentId, rest)
          }
        } yield position
    }

  private def findSegmentIdInBucket(
      datasetId: Option[ObjectId],
      agglomerateFileKey: AgglomerateFileKey,
      dataLayer: DataLayer,
      segmentId: Long,
      topLeft: Vec3Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Option[Vec3Int]] = {
    val request = DataServiceDataRequest(
      datasetId = datasetId,
      dataSourceId = Some(agglomerateFileKey.dataSourceId),
      dataLayer = dataLayer,
      cuboid = Cuboid(
        VoxelPosition(topLeft.x, topLeft.y, topLeft.z, Vec3Int.ones),
        bucketLength,
        bucketLength,
        bucketLength
      ),
      // Empty settings as the volume data stores the unmapped segment id.
      settings = DataServiceRequestSettings()
    )
    for {
      data <- binaryDataServiceHolderProvider.get().binaryDataService.handleDataRequest(request)
      voxels <- tryo(decodeUint64Array(data)).toFox
      index = voxels.indexOf(segmentId)
    } yield
      if (index < 0) None
      else
        Some(
          Vec3Int(
            topLeft.x + index % bucketLength,
            topLeft.y + (index / bucketLength) % bucketLength,
            topLeft.z + index / (bucketLength * bucketLength)
          )
        )
  }

  def largestAgglomerateId(agglomerateFileKey: AgglomerateFileKey)(using ec: ExecutionContext): Fox[Long] =
    Fox.failure(Msg.AgglomerateFile.Pcg.largestIdUnavailable(agglomerateFileKey.attachment.name))

  def clearCache(predicate: AgglomerateFileKey => Boolean): Int = {
    val clearedRoots = supervoxelToAgglomerateFallbackCache.clear { case (key, _) => predicate(key) }
    val clearedChunks = chunkToAgglomerateMappingsCache.clear { case (key, _) => predicate(key) }
    val clearedLeaves = leavesCache.clear { case (key, _) => predicate(key) }
    graphInfoCache.clear(predicate)
    clearedRoots + clearedChunks + clearedLeaves
  }
}

/** One PCG chunk's supervoxel -> root mapping, as two arrays ordered by supervoxel id for binary search optimization.
  */
private case class PcgChunkMapping(supervoxelIds: Array[Long], rootIds: Array[Long]) {
  def size: Int = supervoxelIds.length

  def rootOf(supervoxelId: Long): Option[Long] = {
    val index = java.util.Arrays.binarySearch(supervoxelIds, supervoxelId)
    if (index >= 0) Some(rootIds(index)) else None
  }
}

private object PcgChunkMapping {

  /** From PCG's `[supervoxel, root, supervoxel, root, ...]` reply. Sorts by supervoxel ids if needed.
    */
  def fromInterleaved(pairs: Array[Long]): PcgChunkMapping = {
    val count = pairs.length / 2
    val supervoxelIds = Array.tabulate(count)(i => pairs(2 * i))
    val rootIds = Array.tabulate(count)(i => pairs(2 * i + 1))
    val isSorted = (1 until count).forall(i => supervoxelIds(i - 1) <= supervoxelIds(i))
    if (isSorted) PcgChunkMapping(supervoxelIds, rootIds)
    else {
      val order = Array.range(0, count).sortBy(supervoxelIds(_))
      PcgChunkMapping(order.map(supervoxelIds(_)), order.map(rootIds(_)))
    }
  }
}

/** LRU over chunk mappings, bounded by the supervoxels it holds rather than by the number of chunks as chunks can be
  * sparse and dense.
  */
private class ChunkMappingCache(maxSupervoxels: Long) {
  private val entries =
    new java.util.LinkedHashMap[(AgglomerateFileKey, Long), PcgChunkMapping](64, 0.75f, true /* access order */ )
  private var heldSupervoxels: Long = 0L

  def get(key: (AgglomerateFileKey, Long)): Option[PcgChunkMapping] =
    entries.synchronized(Option(entries.get(key)))

  def put(key: (AgglomerateFileKey, Long), mapping: PcgChunkMapping): Unit =
    entries.synchronized {
      // A chunk that alone exceeds the budget would evict everything and then itself. Leave it out; its supervoxels
      // are then looked up by id, which is what every graph did before this cache existed.
      if (mapping.size <= maxSupervoxels) {
        Option(entries.put(key, mapping)).foreach(previous => heldSupervoxels -= previous.size)
        heldSupervoxels += mapping.size
        val iterator = entries.entrySet.iterator
        while (heldSupervoxels > maxSupervoxels && iterator.hasNext) {
          val eldest = iterator.next()
          if (eldest.getKey != key) {
            heldSupervoxels -= eldest.getValue.size
            iterator.remove()
          }
        }
      }
    }

  def clear(predicate: ((AgglomerateFileKey, Long)) => Boolean): Int =
    entries.synchronized {
      val iterator = entries.entrySet.iterator
      var cleared = 0
      while (iterator.hasNext) {
        val entry = iterator.next()
        if (predicate(entry.getKey)) {
          heldSupervoxels -= entry.getValue.size
          iterator.remove()
          cleared += 1
        }
      }
      cleared
    }
}

/** The part of PCG's `info` that describes how a node id encodes a position: how many bits name the layer, how many
  * name each axis at that layer, and what voxel box a chunk covers.
  */
private case class PcgGraphInfo(
    layerIdBits: Int,
    bitsPerDim: Map[Int, Int],
    chunkSize: Vec3Int,
    chunkGridOrigin: Vec3Int
)

private object PcgGraphInfo {
  implicit val reads: Reads[PcgGraphInfo] = Reads(json =>
    for {
      layerIdBits <- (json \ "graph" \ "n_bits_for_layer_id").validate[Int]
      // Keyed by layer, as strings in JSON ("1" -> 10). Layer 1 is the supervoxel
      // layer; coarser layers get fewer bits as the octree contracts.
      bitMasks <- (json \ "graph" \ "spatial_bit_masks").validate[Map[String, Int]]
      bitsPerDim <- tryo(bitMasks.map { case (layer, bits) => layer.toInt -> bits }) match {
        case Full(parsed) => JsSuccess(parsed)
        case _            => JsError(s"spatial_bit_masks is not keyed by layer number: ${bitMasks.keys}")
      }
      chunkSize <- (json \ "graph" \ "chunk_size").validate[Vec3Int]
      // A chunk's voxel box is chunk * chunkSize, offset by the volume's own
      // voxel_offset when PCG says the chunk grid starts there.
      chunksStartAtVoxelOffset <- (json \ "chunks_start_at_voxel_offset").validateOpt[Boolean]
      voxelOffsetRaw <- (json \ "scales" \ 0 \ "voxel_offset").validateOpt[Vec3Int]
      voxelOffset = voxelOffsetRaw.getOrElse(Vec3Int.zeros)
    } yield PcgGraphInfo(
      layerIdBits,
      bitsPerDim,
      chunkSize,
      if (chunksStartAtVoxelOffset.getOrElse(false)) voxelOffset else Vec3Int.zeros
    )
  )
}

private case class PcgLeaves(leafIds: Seq[Long])

private object PcgLeaves {
  implicit val reads: Reads[PcgLeaves] = Reads(json => (json \ "leaf_ids").validate[Seq[Long]].map(PcgLeaves.apply))
}

private case class PcgSubgraph(edges: Seq[Seq[Long]], affinities: Seq[Float])

private object PcgSubgraph {
  /*
   * PCG names the edge list "nodes" -- it is a list of supervoxel id pairs.
   *
   * Known limitation: PCG writes the affinity of an artificially added edge as
   * float("inf"), which Python emits as a bare `Infinity`. That is not valid JSON, and
   * Jackson rejects the response while tokenizing, before any Reads runs.
   */
  implicit val reads: Reads[PcgSubgraph] = Reads(json =>
    for {
      edges <- (json \ "nodes").validate[Seq[Seq[Long]]]
      affinities <- (json \ "affinities").validate[Seq[Float]]
    } yield PcgSubgraph(edges, affinities)
  )
}
