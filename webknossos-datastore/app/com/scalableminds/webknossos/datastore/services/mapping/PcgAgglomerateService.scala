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
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.box.{Failure, Full}

import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.collection.compat.immutable.ArraySeq
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
  * `generateAgglomerateGraph` and `generateTree` only take the first route: the scan reads a chunk per supervoxel,
  * which for a whole agglomerate would be a read per node. On a pcg that stored no positions they fail rather than
  * return an agglomerate whose nodes all sit at the origin. The alternative to scan all the volume for positions is not
  * viable.
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
class PcgAgglomerateService @Inject() (
    config: DataStoreConfig,
    pcgClient: PcgClient
) extends LazyLogging {

  private lazy val bucketScanner = new NativeBucketScanner()
  private lazy val chunkCacheSizeMultiplier: Int = 8

  // supervoxel -> root (agglomerate id) for fallback /roots_binary route results.
  private lazy val supervoxelToAgglomerateFallbackCache: AlfuCache[(AgglomerateFileKey, Long), Long] =
    AlfuCache(maxCapacity = config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries)

  // supervoxel -> root (agglomerate id) for wk optimized /chunk_root_mapping_binary route results. Weighed by the
  // supervoxels a chunk holds, since a sparse chunk holds a handful and a dense one thousands.
  private lazy val chunkToAgglomerateMappingsCache: AlfuCache[(AgglomerateFileKey, Long), PcgChunkMapping] =
    AlfuCache(
      maxCapacity = config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries * chunkCacheSizeMultiplier,
      weighFn = Some((_, mappingBox) => mappingBox.toOption.map(_.size).getOrElse(0))
    )

  // Limit at which amount of chunks per request to stop the chunk based mapping optimization. Happens when the user zooms out very far.
  private val chunkPrefetchLimit = 32

  // Graphs whose PCG does not support our added chunk-mapping route. -> chunkToAgglomerateMappingsCache cant be used.
  private lazy val graphsWithoutChunkMapping: java.util.Set[AgglomerateFileKey] =
    java.util.concurrent.ConcurrentHashMap.newKeySet[AgglomerateFileKey]()

  // root -> supervoxels cache. Weighed by the supervoxels an agglomerate holds, since a small agglomerate holds a
  // handful and a large one millions -- counting every entry as one would bound the cache at 1000 whole agglomerates.
  private lazy val leavesCache: AlfuCache[(AgglomerateFileKey, Long), Seq[Long]] =
    AlfuCache(
      maxCapacity = config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries,
      weighFn = Some((_, leavesBox) => leavesBox.toOption.map(_.size).getOrElse(0))
    )

  private val bucketLength = DataLayer.bucketLength

  private val scanBatchSize = 8

  /** Ceiling on buckets read for one position lookup. 512 covers a 512x512x64 chunk, the largest a production CAVE
    * graph is likely to use. 512 is the relation of such a 512x512x64 bucket compared to WK Buckets. A 512x512x64
    * volume contains 512 32x32x32 sized buckets.
    */
  private val scanBucketLimit = 512

  // Node-id layout and voxel grid of the graph. Immutable for a graph's lifetime.
  private lazy val graphInfoCache: AlfuCache[AgglomerateFileKey, PcgGraphInfo] = AlfuCache(maxCapacity = 100)

  private def graphInfo(agglomerateFileKey: AgglomerateFileKey)(using ec: ExecutionContext): Fox[PcgGraphInfo] =
    graphInfoCache.getOrLoad(agglomerateFileKey, pcgClient.getGraphInfo)

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
        else pcgClient.postRootsBinary(agglomerateFileKey, missing)
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
          mappingBox <- pcgClient.getChunkRootMapping(agglomerateFileKey, chunkId).shiftBox
          mapping <- mappingBox match {
            case Full(mapping) =>
              chunkToAgglomerateMappingsCache.put((agglomerateFileKey, chunkId), mapping)
              Fox.successful(mapping)
            case failure: Failure =>
              if (pcgClient.looksLikeMissingRoute(failure)) {
                if (graphsWithoutChunkMapping.add(agglomerateFileKey))
                  logger.info(
                    s"${agglomerateFileKey.attachment.path} serves no chunk mappings; reading it one supervoxel at a time"
                  )
              }
              failure.toFox
            case _ => Fox.empty
          }
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
      _ => pcgClient.getLeaves(agglomerateFileKey, agglomerateId)
    )

  private def subgraphForAgglomerateId(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long, edgeLimit: Int)(
      using ec: ExecutionContext
  ): Fox[PcgSubgraph] =
    for {
      subgraph <- pcgClient.getSubgraph(agglomerateFileKey, agglomerateId)
      _ <- Fox.fromBool(subgraph.edges.length <= edgeLimit) ?~>
        Msg.AgglomerateGraph.tooManyEdges(subgraph.edges.length, edgeLimit)
    } yield subgraph

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
      // One request for the whole agglomerate. There is no volume-scan fallback here: that scan reads a chunk per
      // supervoxel, which for a whole agglomerate would be a read per node. A graph whose nodes all sit at the
      // origin is useless and reads as a WEBKNOSSOS bug, so say so instead of returning one.
      positions <- pcgClient.postNodePositions(agglomerateFileKey, segmentIds)
      _ <- Fox.fromBool(segmentIds.isEmpty || positions.nonEmpty) ?~> Msg.AgglomerateFile.Pcg.positionsNotStored
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
      // No volume-scan fallback, for the same reason as in generateAgglomerateGraph.
      positions <- pcgClient.postNodePositions(agglomerateFileKey, segmentIds)
      _ <- Fox.fromBool(segmentIds.isEmpty || positions.nonEmpty) ?~> Msg.AgglomerateFile.Pcg.positionsNotStored
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

  /** A representative voxel of a supervoxel: PCG's own, if it stored one, else found by reading the volume.
    *
    * `loadBucket` reads one bucket of the layer. It is passed in rather than injected because BinaryDataServiceHolder
    * needs AgglomerateService to apply mappings while reading, and this service is one of its branches -- taking the
    * reader as a parameter keeps that from becoming a dependency cycle.
    */
  def positionForSegmentId(
      agglomerateFileKey: AgglomerateFileKey,
      segmentId: Long,
      datasetId: Option[ObjectId],
      dataLayer: DataLayer,
      loadBucket: DataServiceDataRequest => Fox[Array[Byte]]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    for {
      // Asking PCG may fail without being fatal here: the scan below finds the position by reading the volume,
      // which is slower but needs nothing from PCG beyond the graph info already fetched.
      storedBox <- pcgClient.postNodePositions(agglomerateFileKey, Seq(segmentId)).shiftBox
      position <- storedBox.toOption.flatMap(_.get(segmentId)) match {
        case Some(position) => Fox.successful(position)
        case None           => scanPositionForSegmentId(agglomerateFileKey, segmentId, datasetId, dataLayer, loadBucket)
      }
    } yield position

  /** Find a voxel of the supervoxel by reading the volume, for graphs where PCG stored no position.
    */
  private def scanPositionForSegmentId(
      agglomerateFileKey: AgglomerateFileKey,
      segmentId: Long,
      datasetId: Option[ObjectId],
      dataLayer: DataLayer,
      loadBucket: DataServiceDataRequest => Fox[Array[Byte]]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    for {
      graphInfo <- graphInfo(agglomerateFileKey)
      chunkBox <- chunkBoundingBoxForSegmentId(graphInfo, segmentId).toFox
      searchBox <- chunkBox.intersection(dataLayer.boundingBox).toFox ?~>
        Msg.AgglomerateFile.Pcg.chunkOutsideLayerBoundingBox(
          segmentId,
          chunkBox.toString,
          dataLayer.boundingBox.toString
        )
      buckets = bucketTopLeftsIn(searchBox)
      _ <- Fox.fromBool(buckets.length <= scanBucketLimit) ?~>
        Msg.AgglomerateFile.Pcg.chunkTooLargeToScan(segmentId, buckets.length, scanBucketLimit)
      position <- scanForSegmentId(
        datasetId,
        agglomerateFileKey,
        dataLayer,
        segmentId,
        buckets.toList,
        loadBucket
      ) ?~> Msg.AgglomerateFile.Pcg.segmentNotFoundInChunk(segmentId, chunkBox.toString)
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
      buckets: List[Vec3Int],
      loadBucket: DataServiceDataRequest => Fox[Array[Byte]]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    buckets match {
      case Nil => Fox.empty
      case _   =>
        val (batch, rest) = buckets.splitAt(scanBatchSize)
        for {
          hits <- Fox.serialCombined(batch)(topLeft =>
            findSegmentIdInBucket(datasetId, agglomerateFileKey, dataLayer, segmentId, topLeft, loadBucket)
          )
          position <- hits.flatten.headOption match {
            case Some(found) => Fox.successful(found)
            case None        =>
              scanForSegmentId(datasetId, agglomerateFileKey, dataLayer, segmentId, rest, loadBucket)
          }
        } yield position
    }

  private def findSegmentIdInBucket(
      datasetId: Option[ObjectId],
      agglomerateFileKey: AgglomerateFileKey,
      dataLayer: DataLayer,
      segmentId: Long,
      topLeft: Vec3Int,
      loadBucket: DataServiceDataRequest => Fox[Array[Byte]]
  )(using ec: ExecutionContext): Fox[Option[Vec3Int]] = {
    // The request is built here, not by the caller, so that the empty settings cannot be lost =>
    // The scan explicitly requests unmapped / supervoxel-based data.
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
      settings = DataServiceRequestSettings()
    )
    for {
      data <- loadBucket(request)
      voxels <- tryo(PcgClient.decodeUint64Array(data)).toFox
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
