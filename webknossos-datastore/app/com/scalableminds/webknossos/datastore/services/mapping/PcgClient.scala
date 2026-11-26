package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.Msg
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.box.{Failure, Full}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsObject, JsSuccess, Json, Reads}

import java.nio.{ByteBuffer, ByteOrder}
import javax.inject.Inject
import scala.collection.mutable
import scala.concurrent.ExecutionContext

/** One PCG chunk's supervoxel -> root mapping, as two arrays ordered by supervoxel id for binary search optimization.
  */
case class PcgChunkMapping(supervoxelIds: Array[Long], rootIds: Array[Long]) {
  def size: Int = supervoxelIds.length

  def rootOf(supervoxelId: Long): Option[Long] = {
    val index = java.util.Arrays.binarySearch(supervoxelIds, supervoxelId)
    if (index >= 0) Some(rootIds(index)) else None
  }
}

object PcgChunkMapping {

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

/** The part of PCG's `info` that describes how a node id encodes a position: how many bits name the layer, how many
  * name each axis at that layer, and what voxel box a chunk covers.
  */
case class PcgGraphInfo(
    layerIdBits: Int,
    bitsPerDim: Map[Int, Int],
    chunkSize: Vec3Int,
    chunkGridOrigin: Vec3Int
)

object PcgGraphInfo {
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

// Field named after PCG's wire key so that the format can be derived.
case class PcgLeaves(leaf_ids: Seq[Long]) derives JsonAutoFormat

case class PcgSubgraph(edges: Seq[Seq[Long]], affinities: Seq[Float])

object PcgSubgraph {
  /*
   * PCG names the edge list "nodes" -- it is a list of supervoxel id pairs. Hand-written rather than
   * derived, because a derived format would key on the field name and so force the field to be called
   * "nodes" too, carrying that misnomer to every call site.
   *
   * Known limitation needing future consideration: PCG writes the affinity of an artificially added edge
   * as float("inf"), which Python emits as a bare `Infinity`. That is not valid JSON, and
   * Jackson rejects the response while tokenizing, before any Reads runs. Not an issue today since
   * nothing here creates such edges, but it will block PCG-backed editing: proofreading merges
   * routinely add an infinite-affinity edge. Fix then by fetching the raw bytes and parsing them
   * with a Jackson ObjectMapper that has JsonParser.Feature.ALLOW_NON_NUMERIC_NUMBERS enabled,
   * converting the result to a JsValue, and only then running this Reads.
   */
  implicit val reads: Reads[PcgSubgraph] = Reads(json =>
    for {
      edges <- (json \ "nodes").validate[Seq[Seq[Long]]]
      affinities <- (json \ "affinities").validate[Seq[Float]]
    } yield PcgSubgraph(edges, affinities)
  )
}

class PcgClient @Inject() (rpc: RPC) extends LazyLogging {

  private def baseUrl(agglomerateFileKey: AgglomerateFileKey): String =
    agglomerateFileKey.attachment.path.toString.stripSuffix("/")

  // PCGs info url is not versioned, thus removing this part from the URL here.
  private def infoUrl(agglomerateFileKey: AgglomerateFileKey): String =
    s"${baseUrl(agglomerateFileKey).replace("/api/v1/table/", "/table/")}/info"

  def getGraphInfo(agglomerateFileKey: AgglomerateFileKey): Fox[PcgGraphInfo] =
    rpc(infoUrl(agglomerateFileKey)).silent.getWithJsonResponse[PcgGraphInfo]

  def postRootsBinary(agglomerateFileKey: AgglomerateFileKey, supervoxelIds: Array[Long])(using
      ec: ExecutionContext
  ): Fox[Array[Long]] = {
    val body = ByteBuffer.allocate(supervoxelIds.length * 8).order(ByteOrder.LITTLE_ENDIAN)
    supervoxelIds.foreach(body.putLong)
    for {
      responseBytes <- rpc(s"${baseUrl(agglomerateFileKey)}/roots_binary").silent
        .addHttpHeader("Content-Type", "application/octet-stream")
        .postBytesWithBytesResponse(body.array)
      roots <- tryo(PcgClient.decodeUint64Array(responseBytes)).toFox
      _ <- Fox.fromBool(roots.length == supervoxelIds.length) ?~>
        Msg.AgglomerateFile.Pcg.rootCountMismatch(roots.length, supervoxelIds.length)
    } yield roots
  }

  /** The optimized route replying with all supervoxel -> root / agglomerate id mappings of a chunk.
    */
  def getChunkRootMapping(agglomerateFileKey: AgglomerateFileKey, chunkId: Long)(using
      ec: ExecutionContext
  ): Fox[PcgChunkMapping] = {
    val chunk = java.lang.Long.toUnsignedString(chunkId)
    for {
      responseBytes <- rpc(
        s"${baseUrl(agglomerateFileKey)}/chunk_root_mapping_binary/$chunk"
      ).silentEvenOnFailure.getWithBytesResponse
      pairs <- tryo(PcgClient.decodeUint64Array(responseBytes)).toFox
      _ <- Fox.fromBool(pairs.length % 2 == 0) ?~>
        Msg.AgglomerateFile.Pcg.chunkMappingNotPaired(pairs.length, chunk)
      mapping <- tryo(PcgChunkMapping.fromInterleaved(pairs)).toFox
    } yield mapping
  }

  def getLeaves(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long): Fox[Seq[Long]] =
    rpc(s"${baseUrl(agglomerateFileKey)}/node/$agglomerateId/leaves").silent
      .getWithJsonResponse[PcgLeaves]
      .map(_.leaf_ids)

  def getSubgraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext
  ): Fox[PcgSubgraph] =
    for {
      response <- rpc(s"${baseUrl(agglomerateFileKey)}/node/$agglomerateId/subgraph").silent
        .getWithJsonResponse[PcgSubgraph]
      _ <- Fox.fromBool(response.edges.length == response.affinities.length) ?~>
        Msg.AgglomerateFile.Pcg.subgraphAffinityCountMismatch(response.edges.length, response.affinities.length)
      folded <- tryo(foldEdgeDirections(response)).toFox
    } yield folded

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

  /** Voxel coordinates PCG recorded at ingest, for whichever of these ids have one. None for segment ids which don't
    * have this info.
    *
    * An empty answer means the graph stores no positions at all: it was ingested without `store_positions` (PCG answers
    * `{}`) or its PCG has no such route (404). Every other failure is a real one and is passed on, so that a PCG that
    * is merely unreachable cannot read as "this graph has no positions".
    */
  def postNodePositions(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext
  ): Fox[Map[Long, Vec3Int]] =
    if (segmentIds.isEmpty) Fox.successful(Map.empty)
    else
      for {
        responseBox <- rpc(s"${baseUrl(agglomerateFileKey)}/node_positions").silentEvenOnFailure
          .postJsonWithJsonResponse[JsObject, Map[String, Seq[Int]]](Json.obj("node_ids" -> segmentIds))
          .shiftBox
        positions <- responseBox match {
          case Full(raw) =>
            Fox.successful(raw.flatMap {
              case (id, Seq(x, y, z)) => id.toLongOption.map(_ -> Vec3Int(x, y, z))
              case _                  => None
            })
          case failure: Failure if looksLikeMissingRoute(failure) => Fox.successful(Map.empty[Long, Vec3Int])
          case failure: Failure                                   => failure.toFox
          case _                                                  => Fox.empty
        }
      } yield positions

  /** 404 where the route would be, or 405 where an older PCG has the path but not the method. */
  def looksLikeMissingRoute(failure: Failure): Boolean =
    failure.msg.contains("Response: 404") || failure.msg.contains("Response: 405")
}

object PcgClient {

  /** PCG's binary routes all reply with little-endian uint64. The bucket data the position scan reads is in the same
    * layout, which is why this is not private to the client.
    */
  def decodeUint64Array(bytes: Array[Byte]): Array[Long] = {
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
    val result = new Array[Long](buffer.remaining())
    buffer.get(result)
    result
  }
}
