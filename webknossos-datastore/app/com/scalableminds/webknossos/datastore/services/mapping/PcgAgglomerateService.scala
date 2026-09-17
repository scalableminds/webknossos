package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.cache.{AlfuCache, LRUConcurrentCache}
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
import play.api.libs.json.{JsError, JsObject, JsResult, JsSuccess, Json, Reads}

import java.nio.{ByteBuffer, ByteOrder}
import com.scalableminds.util.objectid.ObjectId

import javax.inject.{Inject, Provider}
import scala.collection.compat.immutable.ArraySeq
import scala.collection.mutable
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

/**
 * Serves agglomerate mappings from a PyChunkedGraph instance over HTTP, as a third
 * `LayerAttachmentDataformat` next to hdf5 and zarr3.
 *
 * The attachment `path` is the base URL of a PCG table, e.g.
 * `http://localhost:4000/segmentation/api/v1/table/big`; endpoints are appended to it.
 *
 * Positions are the awkward part: PCG stores topology over an immutable volume and keeps
 * no coordinates for its own sake. There are two ways to get one, and this service uses
 * both:
 *
 *  - If the graph was ingested with `store_positions`, PCG has a representative voxel per
 *    supervoxel and `POST /node_positions` returns it. One point read.
 *  - Otherwise, decode the chunk out of the supervoxel id and read that chunk of the
 *    volume until the id turns up. Exact, but a production chunk is hundreds of buckets.
 *    See `positionForSegmentId`.
 *
 * `generateAgglomerateGraph` and `generateTree` only take the first route, so nodes of a
 * graph ingested without positions stay at the origin.
 *
 * PCG has no largest agglomerate id -- ids are chunk-encoded and sparse, so there is
 * nothing to allocate from and `largestAgglomerateId` fails.
 */
object PcgAgglomerateService {

  /** How much bigger, counted in supervoxels, the chunk cache is than the per-id one. Per supervoxel
    * the chunk cache spends two slots in a long array where the per-id cache spends a boxed key, a
    * boxed value and a hash entry, so this is roughly the same memory, not more of it.
    */
  val chunkCacheOvercommit: Int = 8
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

  /** supervoxel -> root, one supervoxel at a time. The fallback cache: used for graphs whose PCG
    * cannot serve a chunk at a time, and for the odd id a chunk mapping does not account for.
    *
    * A root only changes when the graph is edited, so entries are kept until evicted.
    */
  private lazy val rootCache = new LRUConcurrentCache[(AgglomerateFileKey, Long), Long] {
    val maxEntries: Int = config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries
  }

  /** supervoxel -> root, a whole PCG chunk at a time. This is the cache that carries browsing.
    *
    * A supervoxel id names the chunk it lives in, and `chunk_root_mapping_binary` returns that whole
    * chunk's mapping in one request. Looking at a volume is local, so the neighbours of the id that
    * missed are the ids the next buckets ask for. A production CAVE chunk of 512x512x64 voxels is
    * 128 WEBKNOSSOS buckets, which browsing across then costs one request instead of 128.
    *
    * It does not turn an unbounded working set into a bounded one: a volume larger than the cache
    * still evicts what it is about to need. It moves that threshold rather than removing it.
    */
  private lazy val chunkMappingCache =
    new ChunkMappingCache(
      config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries.toLong * PcgAgglomerateService.chunkCacheOvercommit
    )

  /** Chunks one request may fetch before prefetching stops paying.
    *
    * A bucket at mag 1 sits in one or two chunks. A zoomed-out bucket covers many and samples only a
    * few supervoxels from each, so fetching them whole would read far more than it answers. Past
    * this many, the request asks for exactly the ids it needs.
    */
  private val chunkPrefetchLimit = 32

  /** Graphs whose PCG has no chunk-mapping route, so that we ask once and then stop asking. Such a
    * graph is read one supervoxel at a time, which is slower but not broken.
    */
  private lazy val graphsWithoutChunkMapping: java.util.Set[AgglomerateFileKey] =
    java.util.concurrent.ConcurrentHashMap.newKeySet[AgglomerateFileKey]()

  // root -> supervoxels. Short TTL, because a stale member list is visibly wrong right
  // after an edit.
  private lazy val leavesCache: AlfuCache[(AgglomerateFileKey, Long), Seq[Long]] =
    AlfuCache(maxCapacity = 100, timeToLive = 1 minute, timeToIdle = 1 minute)

  private val bucketLength = DataLayer.bucketLength

  /** Buckets read in parallel per round of a position scan. Keeps a miss-heavy
    * scan from being one serial round trip per bucket without flooding the vault. */
  private val scanBatchSize = 8

  /** Ceiling on buckets read for one position lookup. 512 covers a 512x512x64
    * chunk, the largest a production CAVE graph is likely to use. */
  private val scanBucketLimit = 512

  // Node-id layout and voxel grid of the graph. Immutable for a graph's lifetime.
  private lazy val graphInfoCache: AlfuCache[AgglomerateFileKey, PcgGraphInfo] = AlfuCache(maxCapacity = 100)

  private def graphInfo(agglomerateFileKey: AgglomerateFileKey)(using ec: ExecutionContext): Fox[PcgGraphInfo] =
    graphInfoCache.getOrLoad(
      agglomerateFileKey,
      key => rpc(infoUrl(key)).silent.getWithJsonResponse[PcgGraphInfo]
    )

  def clearCache(predicate: AgglomerateFileKey => Boolean): Int = {
    val clearedRoots = rootCache.clear { case (key, _) => predicate(key) }
    val clearedChunks = chunkMappingCache.clear { case (key, _) => predicate(key) }
    val clearedLeaves = leavesCache.clear { case (key, _) => predicate(key) }
    graphInfoCache.clear(predicate)
    clearedRoots + clearedChunks + clearedLeaves
  }

  private def baseUrl(agglomerateFileKey: AgglomerateFileKey): String =
    agglomerateFileKey.attachment.path.toString.stripSuffix("/")

  /** PCG serves `info` outside its versioned API prefix, so the attachment URL
    * ".../segmentation/api/v1/table/<id>" has to become
    * ".../segmentation/table/<id>/info". Every other call keeps the api/v1 path. */
  private def infoUrl(agglomerateFileKey: AgglomerateFileKey): String =
    s"${baseUrl(agglomerateFileKey).replace("/api/v1/table/", "/table/")}/info"

  private def decodeUint64Array(bytes: Array[Byte]): Array[Long] = {
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
    val result = new Array[Long](buffer.remaining())
    buffer.get(result)
    result
  }

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
        s"PCG returned ${roots.length} roots for ${supervoxelIds.length} supervoxels"
    } yield roots
  }

  /** Batched supervoxel -> root. Zero is the background label in WEBKNOSSOS and not a PCG node, so
    * it maps to zero without asking.
    *
    * Answered a chunk at a time where the graph's PCG can do that, and per supervoxel otherwise. The
    * two paths give the same answers and differ only in what they leave in the cache.
    */
  private def rootsForSupervoxels(agglomerateFileKey: AgglomerateFileKey, supervoxelIds: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Seq[Long]] = {
    val distinct = supervoxelIds.iterator.distinct.filter(_ != 0L).toSeq
    for {
      viaChunks <- rootsViaChunks(agglomerateFileKey, distinct)
      lookup <- viaChunks match {
        case Some(fromChunks) =>
          // A supervoxel its own chunk does not account for should not happen, but asking for it by id is cheap and
          // keeps a surprise from turning into a black voxel.
          val unaccounted = distinct.filterNot(fromChunks.contains)
          if (unaccounted.isEmpty) Fox.successful(fromChunks)
          else rootsViaSupervoxels(agglomerateFileKey, unaccounted).map(fromChunks ++ _)
        case None => rootsViaSupervoxels(agglomerateFileKey, distinct)
      }
    } yield supervoxelIds.map(id => if (id == 0L) 0L else lookup.getOrElse(id, 0L))
  }

  /** The per-supervoxel path: ask PCG for exactly the ids that are not cached. */
  private def rootsViaSupervoxels(agglomerateFileKey: AgglomerateFileKey, distinct: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Map[Long, Long]] = {
    val cached: Map[Long, Long] =
      distinct.iterator.flatMap(id => rootCache.get((agglomerateFileKey, id)).map(id -> _)).toMap
    val missing: Array[Long] = distinct.iterator.filterNot(cached.contains).toArray
    for {
      fetched <-
        if (missing.isEmpty) Fox.successful(Array.empty[Long])
        else postRootsBinary(agglomerateFileKey, missing)
      _ = missing.indices.foreach(i => rootCache.put((agglomerateFileKey, missing(i)), fetched(i)))
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
  private def rootsViaChunks(agglomerateFileKey: AgglomerateFileKey, distinct: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Option[Map[Long, Long]]] =
    if (distinct.isEmpty || graphsWithoutChunkMapping.contains(agglomerateFileKey)) Fox.successful(None)
    else
      for {
        infoBox <- graphInfo(agglomerateFileKey).shiftBox
        chunkIdsOpt = infoBox.toOption.flatMap(info =>
          tryo(distinct.iterator.map(chunkIdOf(info, _)).distinct.toSeq).toOption
        )
        result <- chunkIdsOpt match {
          case Some(chunkIds) if chunkIds.length <= chunkPrefetchLimit =>
            for {
              mappingsBox <- Fox.combined(chunkIds.map(chunkMappingFor(agglomerateFileKey, _))).shiftBox
              answer = mappingsBox match {
                case Full(mappings) =>
                  Some(distinct.iterator.flatMap(id => rootOfIn(mappings, id).map(id -> _)).toMap)
                case _ => None
              }
            } yield answer
          case _ => Fox.successful(None)
        }
      } yield result

  private def rootOfIn(mappings: Seq[PcgChunkMapping], supervoxelId: Long): Option[Long] =
    mappings.iterator.flatMap(_.rootOf(supervoxelId)).nextOption()

  /** One chunk's mapping, from the cache or from PCG. A failure that looks like "this PCG has no such route" is
    * remembered for the graph, so an upstream deployment costs one failed request rather than one per read.
    */
  private def chunkMappingFor(agglomerateFileKey: AgglomerateFileKey, chunkId: Long)(using
      ec: ExecutionContext
  ): Fox[PcgChunkMapping] =
    chunkMappingCache.get((agglomerateFileKey, chunkId)) match {
      case Some(mapping) => Fox.successful(mapping)
      case None          =>
        for {
          mappingBox <- fetchChunkMapping(agglomerateFileKey, chunkId).shiftBox
          mapping <- mappingBox match {
            case Full(mapping) =>
              chunkMappingCache.put((agglomerateFileKey, chunkId), mapping)
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

  /** 404 where the route would be, or 405 where an older PCG has the path but not the method. */
  private def looksLikeMissingRoute(failure: Failure): Boolean =
    failure.msg.contains("Response: 404") || failure.msg.contains("Response: 405")

  private def fetchChunkMapping(agglomerateFileKey: AgglomerateFileKey, chunkId: Long)(using
      ec: ExecutionContext
  ): Fox[PcgChunkMapping] = {
    val chunk = java.lang.Long.toUnsignedString(chunkId)
    for {
      responseBytes <- rpc(s"${baseUrl(agglomerateFileKey)}/chunk_root_mapping_binary/$chunk").silentEvenOnFailure
        .getWithBytesResponse
      pairs <- tryo(decodeUint64Array(responseBytes)).toFox
      _ <- Fox.fromBool(pairs.length % 2 == 0) ?~>
        s"PCG returned ${pairs.length} values for chunk $chunk, which is not a list of pairs"
      mapping <- tryo(PcgChunkMapping.fromInterleaved(pairs)).toFox
    } yield mapping
  }

  /** The chunk a supervoxel belongs to, which is its own id with the counter bits cleared -- PCG's `get_chunk_id`.
    * The layout is `[layer | x | y | z | counter]`, so everything above the counter names the chunk.
    */
  private def chunkIdOf(graphInfo: PcgGraphInfo, supervoxelId: Long): Long = {
    val layer = supervoxelId >>> (64 - graphInfo.layerIdBits)
    val bitsPerDim = graphInfo.bitsPerDim.getOrElse(
      layer.toInt,
      throw new Exception(s"PCG reports no chunk bit width for layer $layer (id $supervoxelId)")
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
      agglomerateIds <- rootsForSupervoxels(agglomerateFileKey, ArraySeq.unsafeWrapArray(distinctSegmentIds))
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
  ): Fox[Seq[Long]] = rootsForSupervoxels(agglomerateFileKey, segmentIds)

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

  /**
   * PCG stores a cross-chunk edge in both chunks it touches, so `subgraph` returns it twice,
   * once as (a, b) and once as (b, a). WEBKNOSSOS's agglomerate graph is undirected, and the
   * min-cut builds a JGraphT SimpleWeightedGraph, which refuses a parallel edge and fails the
   * whole request. Fold the two directions together, keeping the affinity of the copy that
   * survives. Every agglomerate spanning a chunk boundary has such edges.
   */
  private def foldEdgeDirections(response: PcgSubgraph): PcgSubgraph = {
    val seen = mutable.HashSet[(Long, Long)]()
    val kept = response.edges.zip(response.affinities).filter { case (edge, _) =>
      seen.add((math.min(edge(0), edge(1)), math.max(edge(0), edge(1))))
    }
    PcgSubgraph(kept.map(_._1), kept.map(_._2))
  }

  private def subgraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long, edgeLimit: Int)(using
      ec: ExecutionContext
  ): Fox[PcgSubgraph] =
    for {
      response <- rpc(s"${baseUrl(agglomerateFileKey)}/node/$agglomerateId/subgraph").silent
        .getWithJsonResponse[PcgSubgraph]
      folded <- tryo(foldEdgeDirections(response)).toFox
      _ <- Fox.fromBool(folded.edges.length <= edgeLimit) ?~>
        s"Agglomerate has too many edges (${folded.edges.length} > $edgeLimit)"
    } yield folded

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext
  ): Fox[AgglomerateGraph] =
    for {
      segmentIds <- segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
      edgeLimit = config.Datastore.AgglomerateGraph.maxEdges
      _ <- Fox.fromBool(segmentIds.length <= edgeLimit) ?~>
        s"Agglomerate has too many nodes (${segmentIds.length} > $edgeLimit)"
      response <- subgraph(agglomerateFileKey, agglomerateId, edgeLimit)
      edges <- tryo(response.edges.map(e => AgglomerateEdge(source = e(0), target = e(1)))).toFox
      // One request for the whole agglomerate. A supervoxel PCG has no position for stays
      // at the origin; scanning the volume for each of them would cost a read per node.
      positions <- storedPositions(agglomerateFileKey, segmentIds)
    } yield AgglomerateGraph(
      segments = segmentIds,
      edges = edges,
      positions = segmentIds.map(positionProtoFor(positions, _)),
      affinities = response.affinities
    )

  def generateTree(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext
  ): Fox[SkeletonTracing] =
    for {
      segmentIds <- segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
      edgeLimit = config.Datastore.AgglomerateTree.maxEdges
      _ <- Fox.fromBool(segmentIds.length <= edgeLimit) ?~>
        s"Agglomerate has too many nodes (${segmentIds.length} > $edgeLimit)"
      response <- subgraph(agglomerateFileKey, agglomerateId, edgeLimit)
      positions <- storedPositions(agglomerateFileKey, segmentIds)
      nodeIdStartAtOneOffset = 1
      // PCG's subgraph edges name supervoxels; skeleton edges name node indices.
      indexBySegmentId = segmentIds.iterator.zipWithIndex.map { case (id, idx) =>
        id -> (idx + nodeIdStartAtOneOffset)
      }.toMap
      nodes = segmentIds.indices.map { idx =>
        NodeDefaults.createInstance.copy(
          id = idx + nodeIdStartAtOneOffset,
          position = positionProtoFor(positions, segmentIds(idx))
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
          agglomerateInfo = Some(TreeAgglomerateInfoProto(agglomerateId, None, Some(agglomerateFileKey.attachment.name)))
        )
      )
    )

  /** A node's position for the graph and skeleton calls, or the origin if PCG has none. */
  private def positionProtoFor(positions: Map[Long, Vec3Int], segmentId: Long): Vec3IntProto =
    positions.get(segmentId) match {
      case Some(p) => Vec3IntProto(p.x, p.y, p.z)
      case None    => Vec3IntProto(0, 0, 0)
    }

  /**
   * Voxel coordinates PCG recorded at ingest, for whichever of these ids have one.
   *
   * Never fails. An empty answer is the normal result for a graph ingested without
   * `store_positions` (PCG returns `{}`) and for a PCG that predates the `node_positions`
   * route (404). Any other failure is treated the same way, because falling back to the
   * volume scan is always correct, only slower.
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

  /** A representative voxel of a supervoxel: PCG's own, if it stored one, else found by
    * reading the volume. */
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

  /**
   * Find a voxel of the supervoxel by reading the volume, for graphs where PCG stored no
   * position.
   *
   * A supervoxel id is `[layer | x | y | z | segment]`, so it names the chunk the
   * supervoxel lives in. That bounds the search to one chunk: read it a bucket at a time
   * and return the first voxel carrying the id.
   *
   * The voxel returned really belongs to that supervoxel. Proofreading re-reads the
   * segment id at the position it is handed, so a merely nearby coordinate can land in a
   * neighbouring segment and act on the wrong one.
   *
   * A chunk of 512x512x64 voxels is a few hundred buckets, the worst case for one lookup;
   * `scanBatchSize` keeps those reads from being fully serial.
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
      _ <- Fox.fromBool(buckets.length <= scanBucketLimit) ?~> (
        s"Supervoxel $segmentId sits in a PCG chunk of ${buckets.length} buckets, " +
          s"more than the $scanBucketLimit this lookup will read"
      )
      position <- scanForSegmentId(datasetId, agglomerateFileKey, dataLayer, segmentId, buckets.toList) ?~>
        s"Supervoxel $segmentId was not found in its own PCG chunk $chunkBox"
    } yield position

  /**
   * The voxel box of the chunk a node id belongs to. Mirrors PCG's
   * `get_chunk_coordinates` (pychunkedgraph/graph/chunks/utils.py): the layer sits
   * in the top `layerIdBits` bits and selects how many bits each axis gets, with x
   * highest and z lowest.
   */
  private def chunkBoundingBoxForSegmentId(graphInfo: PcgGraphInfo, segmentId: Long): Box[BoundingBox] =
    tryo {
      val layer = segmentId >>> (64 - graphInfo.layerIdBits)
      val bitsPerDim = graphInfo.bitsPerDim.getOrElse(
        layer.toInt,
        throw new Exception(s"PCG reports no chunk bit width for layer $layer (id $segmentId)")
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

  /** Bucket-aligned top-left corners covering the box, in raster order. */
  private def bucketTopLeftsIn(box: BoundingBox): Seq[Vec3Int] = {
    def aligned(v: Int): Int = Math.floorDiv(v, bucketLength) * bucketLength
    for {
      z <- aligned(box.topLeft.z) until box.bottomRight.z by bucketLength
      y <- aligned(box.topLeft.y) until box.bottomRight.y by bucketLength
      x <- aligned(box.topLeft.x) until box.bottomRight.x by bucketLength
    } yield Vec3Int(x, y, z)
  }

  /** Reads buckets in batches, stopping at the first batch that contains the id. */
  private def scanForSegmentId(
      datasetId: Option[ObjectId],
      agglomerateFileKey: AgglomerateFileKey,
      dataLayer: DataLayer,
      segmentId: Long,
      buckets: List[Vec3Int]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    buckets match {
      case Nil => Fox.empty
      case _ =>
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
      // No agglomerate: the scan is looking for the *supervoxel* id, which is what
      // the unmapped layer stores. Applying the mapping here would hide it.
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
    Fox.failure(
      s"largestAgglomerateId is not available for PCG-backed mapping ${agglomerateFileKey.attachment.name}: " +
        "PyChunkedGraph agglomerate ids are chunk-encoded and sparse, so there is no largest id to allocate from."
    )
}

/** One PCG chunk's supervoxel -> root mapping, as two arrays ordered by supervoxel id.
  *
  * Arrays rather than a Map: two slots in a long array per supervoxel is what lets the same memory
  * hold several times as much of the volume.
  */
private case class PcgChunkMapping(supervoxelIds: Array[Long], rootIds: Array[Long]) {
  def size: Int = supervoxelIds.length

  def rootOf(supervoxelId: Long): Option[Long] = {
    val index = java.util.Arrays.binarySearch(supervoxelIds, supervoxelId)
    if (index >= 0) Some(rootIds(index)) else None
  }
}

private object PcgChunkMapping {

  /** From PCG's `[supervoxel, root, supervoxel, root, ...]`.
    *
    * Sorted here rather than trusted to arrive sorted, because `binarySearch` needs the order and a
    * response that is ordered differently would give wrong colours rather than an error.
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

/** LRU over chunk mappings, bounded by the supervoxels it holds rather than by the number of chunks.
  *
  * Counting chunks would bound nothing: a chunk of a sparse region holds a handful of supervoxels
  * and one of dense neuropil holds thousands.
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

/**
 * The part of PCG's `info` that describes how a node id encodes a position:
 * how many bits name the layer, how many name each axis at that layer, and what
 * voxel box a chunk covers.
 */
private case class PcgGraphInfo(
    layerIdBits: Int,
    bitsPerDim: Map[Int, Int],
    chunkSize: Vec3Int,
    chunkGridOrigin: Vec3Int
)

private object PcgGraphInfo {
  private def vec3(values: Seq[Int]): JsResult[Vec3Int] =
    if (values.length == 3) JsSuccess(Vec3Int(values(0), values(1), values(2)))
    else JsError(s"expected three components, got ${values.length}")

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
      chunkSizeRaw <- (json \ "graph" \ "chunk_size").validate[Seq[Int]]
      chunkSize <- vec3(chunkSizeRaw)
      // A chunk's voxel box is chunk * chunkSize, offset by the volume's own
      // voxel_offset when PCG says the chunk grid starts there.
      chunksStartAtVoxelOffset <- (json \ "chunks_start_at_voxel_offset").validateOpt[Boolean]
      voxelOffsetRaw <- (json \ "scales" \ 0 \ "voxel_offset").validateOpt[Seq[Int]]
      voxelOffset <- voxelOffsetRaw.map(vec3).getOrElse(JsSuccess(Vec3Int.zeros))
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
