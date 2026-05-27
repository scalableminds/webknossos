package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{
  ArrayArtifactHashing,
  DSChunkCacheService,
  VoxelyticsZarrArtifactUtils
}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import com.typesafe.scalalogging.LazyLogging
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsResult, JsValue, Reads}
import ucar.ma2.{Array => MultiArray}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class MeshFileAttributes(
    formatVersion: Long,
    meshFormat: String, // AKA encoding (e.g. "draco")
    lodScaleMultiplier: Double,
    transform: Array[Array[Double]],
    hashFunction: Option[String], // v9 hashmap only
    nBuckets: Option[Long], // v9 hashmap only
    btreeHeight: Option[Int], // v10 btree only
    btreeLevelOffsets: Option[Array[Int]], // v10 btree only
    mappingName: Option[String]
) extends ArrayArtifactHashing {
  def isBtreeFormat: Boolean = formatVersion >= 10
  lazy val applyHashFunction: Long => Long = getHashFunction(hashFunction.getOrElse("identity"))
}

object MeshFileAttributes extends MeshFileUtils with VoxelyticsZarrArtifactUtils {
  implicit object MeshFileAttributesZarr3GroupHeaderReads extends Reads[MeshFileAttributes] {
    override def reads(json: JsValue): JsResult[MeshFileAttributes] = {
      val meshFileAttrs = lookUpArtifactAttributes(json)
      for {
        formatVersion <- readArtifactSchemaVersion(json)
        meshFormat <- (meshFileAttrs \ attrKeyMeshFormat).validate[String]
        lodScaleMultiplier <- (meshFileAttrs \ attrKeyLodScaleMultiplier).validate[Double]
        transform <- (meshFileAttrs \ attrKeyTransform).validate[Array[Array[Double]]]
        hashFunction <- (meshFileAttrs \ attrKeyHashFunction).validateOpt[String]
        nBuckets <- (meshFileAttrs \ attrKeyNBuckets).validateOpt[Long]
        btreeHeight <- (meshFileAttrs \ attrKeyBtreeHeight).validateOpt[Int]
        btreeLevelOffsets <- (meshFileAttrs \ attrKeyBtreeLevelOffsets).validateOpt[Array[Int]]
        mappingName <- (meshFileAttrs \ attrKeyMappingName).validateOpt[String]
      } yield
        MeshFileAttributes(
          formatVersion,
          meshFormat,
          lodScaleMultiplier,
          transform,
          hashFunction,
          nBuckets,
          btreeHeight,
          btreeLevelOffsets,
          mappingName,
        )
    }
  }
}

class ZarrMeshFileService @Inject()(chunkCacheService: DSChunkCacheService, dataVaultService: DataVaultService)
    extends FoxImplicits
    with MeshFileUtils
    with NeuroglancerMeshHelper
    with LazyLogging {

  private lazy val openArraysCache = AlfuCache[(MeshFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[MeshFileKey, MeshFileAttributes]()

  private def readMeshFileAttributesImpl(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[MeshFileAttributes] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(meshFileKey.attachment)
      groupHeaderBytes <- (groupVaultPath / MeshFileAttributes.FILENAME_ZARR_JSON)
        .readBytes() ?~> "Could not read mesh file zarr group file"
      meshFileAttributes <- JsonHelper
        .parseAs[MeshFileAttributes](groupHeaderBytes)
        .toFox ?~> "Could not parse meshFile attributes from zarr group file."
    } yield meshFileAttributes

  private def readMeshFileAttributes(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                               tc: TokenContext): Fox[MeshFileAttributes] =
    attributesCache.getOrLoad(meshFileKey, key => readMeshFileAttributesImpl(key))

  def readMeshFileMetadata(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                     tc: TokenContext): Fox[(String, Double, Array[Array[Double]])] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield (meshFileAttributes.meshFormat, meshFileAttributes.lodScaleMultiplier, meshFileAttributes.transform)

  def versionForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.formatVersion

  def mappingNameForMeshFile(meshFileKey: MeshFileKey)(implicit ec: ExecutionContext,
                                                       tc: TokenContext): Fox[Option[String]] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.mappingName

  def listMeshChunksForSegment(meshFileKey: MeshFileKey, segmentId: Long, meshFileAttributes: MeshFileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[MeshLodInfo]] =
    for {
      (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) <- getNeuroglancerSegmentManifestOffsets(
        meshFileKey,
        meshFileAttributes,
        segmentId)
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      manifestBytes <- neuroglancerArray.readAsMultiArray(
        offset = neuroglancerSegmentManifestStart,
        shape = (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt)
      segmentManifest <- tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes.getStorage.asInstanceOf[Array[Byte]])).toFox
    } yield
      enrichSegmentInfo(segmentManifest,
                        meshFileAttributes.lodScaleMultiplier,
                        meshFileAttributes.transform,
                        neuroglancerSegmentManifestStart,
                        segmentId)

  private def getNeuroglancerSegmentManifestOffsets(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] =
    if (meshFileAttributes.isBtreeFormat)
      getBtreeNeuroglancerManifestOffsets(meshFileKey, meshFileAttributes, segmentId)
    else
      getHashmapNeuroglancerManifestOffsets(meshFileKey, meshFileAttributes, segmentId)

  private def getHashmapNeuroglancerManifestOffsets(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] = {
    val bucketIndex = meshFileAttributes.applyHashFunction(segmentId) % meshFileAttributes.nBuckets.getOrElse(1L)
    for {
      bucketOffsetsArray <- openZarrArray(meshFileKey, keyBucketOffsets)
      bucketRange <- bucketOffsetsArray.readAsMultiArray(offset = bucketIndex, shape = 2)
      bucketStart <- tryo(bucketRange.getLong(0)).toFox
      bucketEnd <- tryo(bucketRange.getLong(1)).toFox
      bucketSize = (bucketEnd - bucketStart).toInt
      _ <- Fox.fromBool(bucketSize > 0) ?~> s"No entry for segment $segmentId"
      bucketsArray <- openZarrArray(meshFileKey, keyBuckets)
      bucket <- bucketsArray.readAsMultiArray(offset = Array(bucketStart, 0), shape = Array(bucketSize + 1, 3))
      bucketLocalOffset <- findLocalOffsetInBucket(bucket, segmentId).toFox ?~> s"SegmentId $segmentId not in bucket list"
      neuroglancerStart = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 1)))
      neuroglancerEnd = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 2)))
    } yield (neuroglancerStart, neuroglancerEnd)
  }

  private def findLocalOffsetInBucket(bucket: MultiArray, segmentId: Long): Option[Int] =
    (0 until bucket.getShape()(0)).find(idx => bucket.getLong(bucket.getIndex.set(Array(idx, 0))) == segmentId)

  private def getBtreeNeuroglancerManifestOffsets(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] = {
    val height = meshFileAttributes.btreeHeight.getOrElse(1)
    val levelOffsets = meshFileAttributes.btreeLevelOffsets.getOrElse(Array.empty[Int])

    def traverseInternals(level: Int, childIdx: Long): Fox[Long] =
      if (level >= height - 1) Fox.successful(childIdx)
      else
        for {
          internalArr <- openZarrArray(meshFileKey, keyBtreeInternal)
          nodeArr <- internalArr.readAsMultiArray(offset = Array(levelOffsets(level).toLong + childIdx, 0L),
                                                  shape = Array(1, BTREE_NODE_U64S))
          nKeys = nodeArr.getLong(nodeArr.getIndex.set(Array(0, 0))).toInt
          keyIdx = upperBound(nodeArr, nKeys, segmentId)
          nextChild = nodeArr.getLong(nodeArr.getIndex.set(Array(0, nKeys + 1 + keyIdx)))
          result <- traverseInternals(level + 1, nextChild)
        } yield result

    for {
      leafIdx <- traverseInternals(0, 0L)
      leavesArr <- openZarrArray(meshFileKey, keyBtreeLeaves)
      leafArr <- leavesArr.readAsMultiArray(offset = Array(leafIdx, 0L), shape = Array(1, BTREE_NODE_U64S))
      nEntries = leafArr.getLong(leafArr.getIndex.set(Array(0, 0))).toInt
      result <- findInLeaf(leafArr, nEntries, segmentId).toFox ?~> s"SegmentId $segmentId not found in btree"
    } yield result
  }

  private def bulkGetBtreeManifestRanges(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long])(implicit ec: ExecutionContext, tc: TokenContext): Fox[Map[Long, (Long, Long)]] = {

    val height       = meshFileAttributes.btreeHeight.getOrElse(1)
    val levelOffsets = meshFileAttributes.btreeLevelOffsets.getOrElse(Array.empty[Int])

    // assignments: Seq[(segmentId, nodeIdx at current level)]
    def traverseLevel(level: Int, assignments: Seq[(Long, Long)]): Fox[Seq[(Long, Long)]] =
      if (level >= height - 1) Fox.successful(assignments)
      else {
        val uniqueNodeIndices = assignments.map(_._2).distinct
        for {
          internalArr <- openZarrArray(meshFileKey, keyBtreeInternal)
          nodeDataSeq <- Fox.combined(uniqueNodeIndices.toList.map { nodeIdx =>
            internalArr
              .readAsMultiArray(offset = Array(levelOffsets(level).toLong + nodeIdx, 0L),
                                shape  = Array(1, BTREE_NODE_U64S))
              .map(nodeIdx -> _)
          })
          nodeDataMap = nodeDataSeq.toMap
          nextAssignments = assignments.map {
            case (segId, nodeIdx) =>
              val node   = nodeDataMap(nodeIdx)
              val nKeys  = node.getLong(node.getIndex.set(Array(0, 0))).toInt
              val keyIdx = upperBound(node, nKeys, segId)
              val child  = node.getLong(node.getIndex.set(Array(0, nKeys + 1 + keyIdx)))
              segId -> child
          }
          result <- traverseLevel(level + 1, nextAssignments)
        } yield result
      }

    for {
      leafAssignments   <- traverseLevel(0, segmentIds.map(_ -> 0L))
      uniqueLeafIndices  = leafAssignments.map(_._2).distinct
      leavesArr         <- openZarrArray(meshFileKey, keyBtreeLeaves)
      leafDataMap <- {
        val leafArray = uniqueLeafIndices.toIndexedSeq
        val counter   = new java.util.concurrent.atomic.AtomicInteger(0)
        def worker(slotIdx: Int): Fox[List[(Long, MultiArray)]] = {
          val slotStart = System.currentTimeMillis()
          def go(acc: List[(Long, MultiArray)]): Fox[List[(Long, MultiArray)]] = {
            val idx = counter.getAndIncrement()
            if (idx >= leafArray.size) {
              logger.info(
                s"Btree leaf slot $slotIdx/${math.min(32, leafArray.size)} (${acc.size} leaves): ${System.currentTimeMillis() - slotStart}ms")
              Fox.successful(acc)
            } else {
              val leafIdx = leafArray(idx)
              for {
                result      <- leavesArr.readAsMultiArray(offset = Array(leafIdx, 0L), shape = Array(1, BTREE_NODE_U64S)).map(leafIdx -> _)
                moreResults <- go(result :: acc)
              } yield moreResults
            }
          }
          go(Nil)
        }
        Fox.combined((0 until math.min(32, leafArray.size)).toList.map(worker)).map(_.flatten.toMap)
      }
      results = leafAssignments.flatMap {
        case (segId, leafIdx) =>
          leafDataMap.get(leafIdx).flatMap { leafArr =>
            val nEntries = leafArr.getLong(leafArr.getIndex.set(Array(0, 0))).toInt
            findInLeaf(leafArr, nEntries, segId).map(segId -> _)
          }
      }
    } yield results.toMap
  }

  private def bulkListMeshChunksForBtreeRemoteSegments(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[MeshLodInfo]]] =
    for {
      manifestRanges  <- bulkGetBtreeManifestRanges(meshFileKey, meshFileAttributes, segmentIds)
      lodInfos <- if (manifestRanges.isEmpty) Fox.successful(List.empty)
      else
        for {
          neuroglancerArr <- openZarrArray(meshFileKey, keyNeuroglancer)
          minStart         = manifestRanges.values.map(_._1).min
          maxEnd           = manifestRanges.values.map(_._2).max
          bulkArr <- neuroglancerArr.readAsMultiArray(offset = minStart,
                                                      shape  = (maxEnd - minStart).toInt)
          bulkBytes = bulkArr.getStorage.asInstanceOf[Array[Byte]]
          infos <- Fox.combined(manifestRanges.toList.map {
            case (segId, (start, end)) =>
              val manifestBytes = bulkBytes.slice((start - minStart).toInt, (end - minStart).toInt)
              for {
                segmentManifest <- tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes)).toFox
              } yield
                enrichSegmentInfo(segmentManifest,
                                  meshFileAttributes.lodScaleMultiplier,
                                  meshFileAttributes.transform,
                                  start,
                                  segId)
          })
        } yield infos
    } yield lodInfos

  // Upper-bound binary search: returns first index i in [0, nKeys] where keys[i] > target.
  // Mirrors numpy searchsorted(keys, target, side="right").
  private def upperBound(node: MultiArray, nKeys: Int, target: Long): Int = {
    var lo = 0
    var hi = nKeys
    while (lo < hi) {
      val mid = lo + (hi - lo) / 2
      if (node.getLong(node.getIndex.set(Array(0, 1 + mid))) <= target) lo = mid + 1
      else hi = mid
    }
    lo
  }

  private def findInLeaf(leaf: MultiArray, nEntries: Int, segmentId: Long): Option[(Long, Long)] =
    (0 until nEntries)
      .find(i => leaf.getLong(leaf.getIndex.set(Array(0, 1 + i * 3))) == segmentId)
      .map { i =>
        val start = leaf.getLong(leaf.getIndex.set(Array(0, 2 + i * 3)))
        val end = leaf.getLong(leaf.getIndex.set(Array(0, 3 + i * 3)))
        (start, end)
      }

  private def openZarrArray(meshFileKey: MeshFileKey, zarrArrayName: String)(implicit ec: ExecutionContext,
                                                                             tc: TokenContext): Fox[DatasetArray] =
    openArraysCache.getOrLoad((meshFileKey, zarrArrayName), _ => openZarrArrayImpl(meshFileKey, zarrArrayName))

  private def openZarrArrayImpl(meshFileKey: MeshFileKey, zarrArrayName: String)(implicit ec: ExecutionContext,
                                                                                 tc: TokenContext): Fox[DatasetArray] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(meshFileKey.attachment)
      zarrArray <- Zarr3Array.open(groupVaultPath / zarrArrayName,
                                   DataSourceId("dummy", "unused"),
                                   "layer",
                                   None,
                                   None,
                                   None,
                                   chunkCacheService.sharedChunkContentsCache)
    } yield zarrArray

  override def computeGlobalPosition(segmentInfo: NeuroglancerSegmentManifest,
                                     lod: Int,
                                     lodScaleMultiplier: Double,
                                     currentChunk: Int): Vec3Float =
    segmentInfo.gridOrigin + segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float * segmentInfo.chunkShape * Math
      .pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

  override def getLodTransform(segmentInfo: NeuroglancerSegmentManifest,
                               lodScaleMultiplier: Double,
                               transform: Array[Array[Double]],
                               lod: Int): Array[Array[Double]] = transform

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext,
      m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
      meshChunksForUnmappedSegments: List[List[MeshLodInfo]] <- listMeshChunksForSegmentsNested(meshFileKey,
                                                                                                segmentIds,
                                                                                                meshFileAttributes)
      _ <- Fox.fromBool(meshChunksForUnmappedSegments.nonEmpty) ?~> "zero chunks" ?~> Messages(
        "mesh.file.listChunks.failed",
        segmentIds.mkString(","),
        meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo
        .fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, meshFileAttributes.meshFormat)
        .toFox
    } yield wkChunkInfos

  private def listMeshChunksForSegmentsNested(meshFileKey: MeshFileKey,
                                              segmentIds: Seq[Long],
                                              meshFileAttributes: MeshFileAttributes)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[MeshLodInfo]]] = {
    // For btree format, sorting segment IDs improves cache locality: consecutive IDs share
    // traversal paths through internal nodes (Zarr chunks cached by sharedChunkContentsCache).
    val orderedSegmentIds = if (meshFileAttributes.isBtreeFormat) segmentIds.sorted else segmentIds
    def lookupOne(segmentId: Long): Fox[Option[List[MeshLodInfo]]] =
      listMeshChunksForSegment(meshFileKey, segmentId, meshFileAttributes).map(Some(_)).orElse(Fox.successful(None))
    if (meshFileAttributes.isBtreeFormat && meshFileKey.attachment.path.isRemote)
      bulkListMeshChunksForBtreeRemoteSegments(meshFileKey, orderedSegmentIds, meshFileAttributes)
    else if (meshFileKey.attachment.path.isRemote)
      Fox.batchCombined(orderedSegmentIds.toSeq, parallelity = 32)(lookupOne).map(_.flatten)
    else
      Fox.serialCombined(orderedSegmentIds)(lookupOne).map(_.flatten)
  }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], String)] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)

      // Sort the requests by byte offset to optimize for spinning disk access
      requestsReordered = meshChunkDataRequests.zipWithIndex
        .sortBy(requestAndIndex => requestAndIndex._1.byteOffset)
        .toList
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      data: List[(Array[Byte], Int)] <- Fox.serialCombined(requestsReordered) { requestAndIndex =>
        val meshChunkDataRequest = requestAndIndex._1
        for {
          dataAsMultiArray <- neuroglancerArray.readAsMultiArray(offset = meshChunkDataRequest.byteOffset,
                                                                 meshChunkDataRequest.byteSize)
        } yield (dataAsMultiArray.getStorage.asInstanceOf[Array[Byte]], requestAndIndex._2)
      }
      dataSorted = data.sortBy(d => d._2)
      dataSortedFlat = dataSorted.flatMap(d => d._1).toArray
    } yield (dataSortedFlat, meshFileAttributes.meshFormat)

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
