package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.cache.{AlfuCache, LRUConcurrentCache}
import com.scalableminds.util.geometry.Vec3Int
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
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Reads

import java.nio.{ByteBuffer, ByteOrder}
import javax.inject.Inject
import scala.collection.compat.immutable.ArraySeq
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

/**
 * Serves agglomerate mappings from a PyChunkedGraph instance over HTTP, as a third
 * `LayerAttachmentDataformat` next to hdf5 and zarr3.
 *
 * The attachment `path` is the base URL of a PCG table, e.g.
 * `http://localhost:4000/segmentation/api/v1/table/big`; endpoints are appended to it.
 *
 * Two limitations to know about:
 *
 *  - PCG has no largest agglomerate id: ids are chunk-encoded and sparse, so there is
 *    nothing to allocate from. `largestAgglomerateId` fails.
 *  - PCG's `subgraph` returns edges but no node positions, so the agglomerate graph and
 *    the skeleton built from it have all positions at zero.
 */
class PcgAgglomerateService @Inject() (config: DataStoreConfig, rpc: RPC) extends LazyLogging {

  private lazy val bucketScanner = new NativeBucketScanner()

  // supervoxel -> root. A root only changes when the graph is edited, so entries are kept
  // until evicted. Without this cache, applying a mapping costs a round trip per bucket.
  private lazy val rootCache = new LRUConcurrentCache[(AgglomerateFileKey, Long), Long] {
    val maxEntries: Int = config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries
  }

  // root -> supervoxels. Short TTL, because a stale member list is visibly wrong right
  // after an edit.
  private lazy val leavesCache: AlfuCache[(AgglomerateFileKey, Long), Seq[Long]] =
    AlfuCache(maxCapacity = 100, timeToLive = 1 minute, timeToIdle = 1 minute)

  def clearCache(predicate: AgglomerateFileKey => Boolean): Int = {
    val clearedRoots = rootCache.clear { case (key, _) => predicate(key) }
    val clearedLeaves = leavesCache.clear { case (key, _) => predicate(key) }
    clearedRoots + clearedLeaves
  }

  private def baseUrl(agglomerateFileKey: AgglomerateFileKey): String =
    agglomerateFileKey.attachment.path.toString.stripSuffix("/")

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

  /**
   * Batched supervoxel -> root with a read-through cache. Zero is the background label in
   * WEBKNOSSOS and not a PCG node, so it maps to zero without asking.
   */
  private def rootsForSupervoxels(agglomerateFileKey: AgglomerateFileKey, supervoxelIds: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Seq[Long]] = {
    val distinct = supervoxelIds.iterator.distinct.filter(_ != 0L).toSeq
    val cached: Map[Long, Long] =
      distinct.iterator.flatMap(id => rootCache.get((agglomerateFileKey, id)).map(id -> _)).toMap
    val missing: Array[Long] = distinct.iterator.filterNot(cached.contains).toArray
    for {
      fetched <- if (missing.isEmpty) Fox.successful(Array.empty[Long])
                 else postRootsBinary(agglomerateFileKey, missing)
      _ = missing.indices.foreach(i => rootCache.put((agglomerateFileKey, missing(i)), fetched(i)))
      // Resolve from a local map, not from the cache: one request larger than maxEntries
      // would otherwise evict its own results before they are used.
      lookup = cached ++ missing.indices.iterator.map(i => missing(i) -> fetched(i))
    } yield supervoxelIds.map(id => if (id == 0L) 0L else lookup.getOrElse(id, 0L))
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

  private def subgraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long, edgeLimit: Int)(using
      ec: ExecutionContext
  ): Fox[PcgSubgraph] =
    for {
      response <- rpc(s"${baseUrl(agglomerateFileKey)}/node/$agglomerateId/subgraph").silent
        .getWithJsonResponse[PcgSubgraph]
      _ <- Fox.fromBool(response.edges.length <= edgeLimit) ?~>
        s"Agglomerate has too many edges (${response.edges.length} > $edgeLimit)"
    } yield response

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
    } yield AgglomerateGraph(
      segments = segmentIds,
      edges = edges,
      positions = segmentIds.map(_ => Vec3IntProto(0, 0, 0)), // PCG carries no positions
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
      nodeIdStartAtOneOffset = 1
      // PCG's subgraph edges name supervoxels; skeleton edges name node indices.
      indexBySegmentId = segmentIds.iterator.zipWithIndex.map { case (id, idx) =>
        id -> (idx + nodeIdStartAtOneOffset)
      }.toMap
      nodes = segmentIds.indices.map { idx =>
        NodeDefaults.createInstance.copy(id = idx + nodeIdStartAtOneOffset, position = Vec3IntProto(0, 0, 0))
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

  def positionForSegmentId(agglomerateFileKey: AgglomerateFileKey, segmentId: Long)(using
      ec: ExecutionContext
  ): Fox[Vec3Int] =
    Fox.failure(
      s"positionForSegmentId is not available for PCG-backed mapping ${agglomerateFileKey.attachment.name}: " +
        "PyChunkedGraph only offers the inverse lookup (coordinate -> supervoxel)."
    )

  def largestAgglomerateId(agglomerateFileKey: AgglomerateFileKey)(using ec: ExecutionContext): Fox[Long] =
    Fox.failure(
      s"largestAgglomerateId is not available for PCG-backed mapping ${agglomerateFileKey.attachment.name}: " +
        "PyChunkedGraph agglomerate ids are chunk-encoded and sparse, so there is no largest id to allocate from."
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
