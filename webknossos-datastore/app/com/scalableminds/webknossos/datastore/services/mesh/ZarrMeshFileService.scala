package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{
  ArrayArtifactHashing,
  DSChunkCacheService,
  VoxelyticsZarrArtifactUtils
}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import play.api.libs.json.{JsResult, JsValue, Reads}
import ucar.ma2.Array as MultiArray

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag
import ZarrMeshFileService.SegmentMeshMetadata

case class MeshFileAttributes(
    formatVersion: Long,
    meshFormat: String, // AKA encoding (e.g. "draco")
    lodScaleMultiplier: Double,
    transform: Array[Array[Double]],
    hashFunction: Option[String], // Only before format version 10
    nBuckets: Option[Long], // Only before format version 10
    mappingName: Option[String],
    nInnerNodeLayers: Option[Int], // Only from format version 10
    dataOrderMappings: Option[Seq[Int]] // Only from format version 10
) extends ArrayArtifactHashing {
  lazy val applyHashFunction: Option[Long => Long] = hashFunction.map(getHashFunction)
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
        mappingName <- (meshFileAttrs \ attrKeyMappingName).validateOpt[String]
        nInnerNodeLayers <- (meshFileAttrs \ attrKeyNInnerNodeLayers).validateOpt[Int]
        dataOrderMappings <- (meshFileAttrs \ attrKeyDataOrderMappings).validateOpt[Seq[Int]]
      } yield MeshFileAttributes(
        formatVersion,
        meshFormat,
        lodScaleMultiplier,
        transform,
        hashFunction,
        nBuckets,
        mappingName,
        nInnerNodeLayers,
        dataOrderMappings
      )
    }
  }
}

class ZarrMeshFileService @Inject() (chunkCacheService: DSChunkCacheService, dataVaultService: DataVaultService)
    extends MeshFileUtils
    with NeuroglancerMeshHelper {

  private lazy val openArraysCache = AlfuCache[(MeshFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[MeshFileKey, MeshFileAttributes]()
  private lazy val maxSegmentLevelPerChunkCache = AlfuCache[MeshFileKey, Array[Byte]]()

  private def readMeshFileAttributesImpl(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[MeshFileAttributes] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(meshFileKey.attachment)
      groupHeaderBytes <- (groupVaultPath / MeshFileAttributes.FILENAME_ZARR_JSON)
        .readBytes() ?~> "Could not read mesh file zarr group file"
      meshFileAttributes <- JsonHelper
        .parseAs[MeshFileAttributes](groupHeaderBytes)
        .toFox ?~> "Could not parse meshFile attributes from zarr group file."
    } yield meshFileAttributes

  private def readMeshFileAttributes(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[MeshFileAttributes] =
    attributesCache.getOrLoad(meshFileKey, key => readMeshFileAttributesImpl(key))

  def readMeshFileMetadata(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[(String, Double, Array[Array[Double]])] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield (meshFileAttributes.meshFormat, meshFileAttributes.lodScaleMultiplier, meshFileAttributes.transform)

  def versionForMeshFile(meshFileKey: MeshFileKey)(using ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.formatVersion

  def mappingNameForMeshFile(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Option[String]] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
    } yield meshFileAttributes.mappingName

  // Empty if the mesh file has no entry for the segment.
  private def listMeshChunksForSegment(
      meshFileKey: MeshFileKey,
      segmentId: Long,
      meshFileAttributes: MeshFileAttributes
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[MeshLodInfo]] =
    for {
      (manifestStart, manifestEnd) <- getNeuroglancerSegmentManifestOffsets(meshFileKey, meshFileAttributes, segmentId)
      segmentManifest <- readSegmentManifest(meshFileKey, manifestStart, manifestEnd)
      lods = enrichSegmentInfo(
        segmentManifest,
        meshFileAttributes.lodScaleMultiplier,
        meshFileAttributes.transform,
        manifestStart,
        segmentId
      )
    } yield lods

  private def readSegmentManifest(meshFileKey: MeshFileKey, manifestStart: Long, manifestEnd: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[NeuroglancerSegmentManifest] =
    for {
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      manifestBytes <- neuroglancerArray.readAsMultiArray(
        offset = manifestStart,
        shape = (manifestEnd - manifestStart).toInt
      )
      segmentManifest <- tryo(
        NeuroglancerSegmentManifest.fromBytes(manifestBytes.getStorage.asInstanceOf[Array[Byte]])
      ).toFox
    } yield segmentManifest

  // Empty if the mesh file has no entry for the segment.
  private def getNeuroglancerSegmentManifestOffsets(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentId: Long
  )(using ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] =
    for {
      applyHashFunction <- meshFileAttributes.applyHashFunction.toFox ?~> "Mesh file has no hash function"
      nBuckets <- meshFileAttributes.nBuckets.toFox ?~> "Mesh file has no bucket count"
      bucketIndex = java.lang.Long.remainderUnsigned(applyHashFunction(segmentId), nBuckets)
      bucketOffsetsArray <- openZarrArray(meshFileKey, keyBucketOffsets)
      bucketRange <- bucketOffsetsArray.readAsMultiArray(offset = bucketIndex, shape = 2)
      bucketStart <- tryo(bucketRange.getLong(0)).toFox
      bucketEnd <- tryo(bucketRange.getLong(1)).toFox
      bucketSize = (bucketEnd - bucketStart).toInt
      manifestOffsets <-
        if (bucketSize > 0) findManifestOffsetsInBucket(meshFileKey, bucketStart, bucketSize, segmentId)
        else Fox.empty
    } yield manifestOffsets

  // Empty if the bucket has no entry for the segment.
  private def findManifestOffsetsInBucket(
      meshFileKey: MeshFileKey,
      bucketStart: Long,
      bucketSize: Int,
      segmentId: Long
  )(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Long, Long)] =
    for {
      bucketsArray <- openZarrArray(meshFileKey, keyBuckets)
      bucket <- bucketsArray.readAsMultiArray(offset = Array(bucketStart, 0), shape = Array(bucketSize + 1, 3))
      bucketLocalOffset <- findLocalOffsetInBucket(bucket, segmentId).toFox
      neuroglancerStart = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 1)))
      neuroglancerEnd = bucket.getLong(bucket.getIndex.set(Array(bucketLocalOffset, 2)))
    } yield (neuroglancerStart, neuroglancerEnd)

  private def findLocalOffsetInBucket(bucket: MultiArray, segmentId: Long): Option[Int] =
    (0 until bucket.getShape()(0)).find(idx => bucket.getLong(bucket.getIndex.set(Array(idx, 0))) == segmentId)

  private def openZarrArray(meshFileKey: MeshFileKey, zarrArrayName: String)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[DatasetArray] =
    openArraysCache.getOrLoad((meshFileKey, zarrArrayName), _ => openZarrArrayImpl(meshFileKey, zarrArrayName))

  private def openZarrArrayImpl(meshFileKey: MeshFileKey, zarrArrayName: String)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[DatasetArray] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(meshFileKey.attachment)
      zarrArray <- Zarr3Array.openForAttachment(
        groupVaultPath / zarrArrayName,
        chunkCacheService.sharedChunkContentsCache
      )
    } yield zarrArray

  override def computeGlobalPosition(
      segmentInfo: NeuroglancerSegmentManifest,
      lod: Int,
      lodScaleMultiplier: Double,
      currentChunk: Int
  ): Vec3Float =
    segmentInfo.gridOrigin + segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float * segmentInfo.chunkShape * Math
      .pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

  override def getLodTransform(
      segmentInfo: NeuroglancerSegmentManifest,
      lodScaleMultiplier: Double,
      transform: Array[Array[Double]],
      lod: Int
  ): Array[Array[Double]] = transform

  /** Lists the mesh chunks of the segments. If they were looked up from an agglomerate of dataOrderMappingName (or of
    * an editable mapping based on it), mesh files with segment mesh metadata in data order find them as runs.
    */
  def listMeshChunksForMultipleSegments(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      dataOrderMappingName: Option[String],
      failOnZeroChunks: Boolean
  )(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[WebknossosSegmentInfo] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
      lookups <- lookUpSegments(
        meshFileKey,
        segmentIds,
        meshFileAttributes,
        dataOrderMappingName
      ) ?~> Msg.Mesh.File.listChunksFailed(segmentIds.mkString(","), meshFileKey.attachment.name)
      _ <- Fox.fromBool(lookups.exists(_.hasEntry) || !failOnZeroChunks) ?~> Msg.Mesh.File
        .zeroChunks(segmentIds.mkString(","), meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo.fromSegmentLookups(lookups, meshFileAttributes.meshFormat).toFox
    } yield wkChunkInfos

  private def lookUpSegments(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes,
      dataOrderMappingName: Option[String]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[SegmentMeshLookup]] =
    // From format version 10, segments are looked up in a static B-tree instead of a hash table.
    if (meshFileAttributes.formatVersion >= 10)
      lookUpSegmentsInBTree(meshFileKey, segmentIds, meshFileAttributes, dataOrderMappingName)
    else lookUpSegmentsSkippingFailed(meshFileKey, segmentIds, meshFileAttributes)

  // Leaves out the segments whose lookup failed, e.g. because of a read error.
  private def lookUpSegmentsSkippingFailed(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[SegmentMeshLookup]] = {
    def lookupOne(segmentId: Long): Fox[Option[SegmentMeshLookup]] =
      listMeshChunksForSegment(meshFileKey, segmentId, meshFileAttributes).shiftBox
        .map(SegmentMeshLookup.fromBox(segmentId, _))
    if (meshFileKey.attachment.path.isRemote)
      Fox.batchCombined(segmentIds, parallelity = 32)(lookupOne).map(_.flatten)
    else
      Fox.serialCombined(segmentIds)(lookupOne).map(_.flatten)
  }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], String)] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      data <- readByteRanges(
        neuroglancerArray,
        meshChunkDataRequests.map(request => (request.byteOffset, request.byteOffset + request.byteSize))
      )
    } yield (Array.concat(data*), meshFileAttributes.meshFormat)

  /* Segments that the B-tree has no entry for, or whose segment mesh metadata is empty, have no mesh. Segments whose
   * manifest cannot be parsed are left out, like failed lookups. Segments with a mesh come first, in data order.
   */
  private def lookUpSegmentsInBTree(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes,
      dataOrderMappingName: Option[String]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[SegmentMeshLookup]] = {
    val level = for {
      mappingName <- dataOrderMappingName
      percentile <- ZarrMeshFileService.percentileOfMappingName(mappingName)
      mappings <- meshFileAttributes.dataOrderMappings
      level = mappings.indexOf(percentile)
      if level >= 0
    } yield level
    for {
      _ <- prepareBTreeArrays(meshFileKey, meshFileAttributes)
      allMeshMetadata <- level match {
        case Some(l) if segmentIds.distinct.length > 1 =>
          lookUpSegmentMeshMetadataByAgglomerateRuns(meshFileKey, meshFileAttributes, segmentIds, l)
        case _ => lookUpSegmentMeshMetadataBySegmentIds(meshFileKey, meshFileAttributes, segmentIds)
      }
      // Segments without a mesh have empty segment mesh metadata.
      segmentMeshMetadata = allMeshMetadata.filter(_.manifestLength > 0)
      manifestsArray <- openZarrArray(meshFileKey, keyManifests)
      // The manifests of many segments share a chunk, so a chunk that cannot be read fails the request.
      manifests <- readByteRanges(
        manifestsArray,
        segmentMeshMetadata.map(meshMetadata =>
          (meshMetadata.manifestOffset, meshMetadata.manifestOffset + meshMetadata.manifestLength)
        )
      ) ?~> "Could not read mesh file manifests"
    } yield {
      val withMesh = segmentMeshMetadata.zip(manifests).toList.flatMap { case (meshMetadata, manifestBytes) =>
        tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes))
          .map(segmentManifest =>
            SegmentMeshLookup(
              meshMetadata.segmentId,
              Some(
                enrichSegmentInfoWithMeshStart(
                  segmentManifest,
                  meshFileAttributes.lodScaleMultiplier,
                  meshFileAttributes.transform,
                  meshMetadata.meshOffset,
                  meshMetadata.segmentId
                )
              )
            )
          )
          .toOption
      }
      val withMeshOrUnparsable = segmentMeshMetadata.map(_.segmentId).toSet
      withMesh ++ segmentIds.distinct.filterNot(withMeshOrUnparsable.contains).map(SegmentMeshLookup(_, None))
    }
  }

  /* Opens the arrays and reads max_segment_level_per_chunk in parallel, so that the first lookup in a mesh file does not
   * open them one after the other. Failures only show up later, where the data is needed.
   */
  private def prepareBTreeArrays(meshFileKey: MeshFileKey, meshFileAttributes: MeshFileAttributes)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Unit] = {
    val arrayNames = Seq(keyLeaves, keySegmentMeshMetadata, keyMaxSegmentLevelPerChunk, keyManifests, keyNeuroglancer) ++
      meshFileAttributes.nInnerNodeLayers.map(layers => (0 until layers).map(keyInnerNodes)).getOrElse(Seq.empty)
    for {
      _ <- Fox.combined(
        arrayNames.map(arrayName => openZarrArray(meshFileKey, arrayName).shiftBox.map(_ => ())) :+
          maxSegmentLevelPerChunkCache.getOrLoad(meshFileKey, readMaxSegmentLevelPerChunk).shiftBox.map(_ => ())
      )
    } yield ()
  }

  /* The segments of an agglomerate of a data order mapping form one run. Runs are found from a few seed segments and
   * only the segment mesh metadata of the requested segments is kept, so that agglomerates of editable mappings, which are
   * unions of parts of such agglomerates, are found as well. Runs that are much longer than the request, e.g. of a
   * large agglomerate that a few requested segments were split off from, are not read. Segments that no read run
   * covers are looked up individually.
   */
  private def lookUpSegmentMeshMetadataByAgglomerateRuns(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long],
      level: Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[SegmentMeshMetadata]] = {
    val requested = segmentIds.toSet
    def lookUpRounds(seedCounts: List[Int], remaining: Set[Long], found: Seq[SegmentMeshMetadata]): Fox[Seq[SegmentMeshMetadata]] =
      seedCounts match {
        case seedCount :: laterSeedCounts if remaining.nonEmpty =>
          val seeds = ZarrMeshFileService.evenlySpaced(remaining.toArray, seedCount)
          for {
            seedIndices <- lookUpSegmentMeshMetadataIndices(meshFileKey, meshFileAttributes, seeds)
            runMeshMetadata <- readAgglomerateRuns(meshFileKey, seedIndices.values.toSeq.distinct, level, requested.size)
            newMeshMetadata = runMeshMetadata.filter(meshMetadata => remaining.contains(meshMetadata.segmentId))
            // Seeds without a mesh are not looked up again.
            notFound = seeds.filterNot(seedIndices.contains).toSet
            result <- lookUpRounds(
              laterSeedCounts,
              remaining -- newMeshMetadata.map(_.segmentId) -- notFound,
              found ++ newMeshMetadata
            )
          } yield result
        case _ =>
          for {
            remainingMeshMetadata <- lookUpSegmentMeshMetadataBySegmentIds(meshFileKey, meshFileAttributes, remaining.toSeq)
          } yield found ++ remainingMeshMetadata
      }
    lookUpRounds(ZarrMeshFileService.seedCountsPerRound, requested, Seq.empty)
  }

  private def lookUpSegmentMeshMetadataBySegmentIds(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[SegmentMeshMetadata]] =
    for {
      indices <- lookUpSegmentMeshMetadataIndices(meshFileKey, meshFileAttributes, segmentIds)
      meshMetadataArray <- openZarrArray(meshFileKey, keySegmentMeshMetadata)
      segmentsPerChunk = meshMetadataArray.chunkShape(0).toLong
      chunks <- readChunks[Long](meshMetadataArray, indices.values.map(_ / segmentsPerChunk).toSeq.distinct.sorted, rank = 2)
    } yield indices.values.toSeq.sorted.map { index =>
      ZarrMeshFileService.segmentMeshMetadataAt(
        chunks(index / segmentsPerChunk),
        meshMetadataArray.chunkShape(1),
        index % segmentsPerChunk
      )
    }

  // The index into the segment mesh meshMetadata of each segment id that has a mesh, looked up in the leaves.
  private def lookUpSegmentMeshMetadataIndices(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Map[Long, Long]] = {
    val sortedSegmentIds = segmentIds.distinct.sortWith(java.lang.Long.compareUnsigned(_, _) < 0).toArray
    for {
      nInnerNodeLayers <- meshFileAttributes.nInnerNodeLayers.toFox ?~> "Mesh file has no inner node layers"
      leavesArray <- openZarrArray(meshFileKey, keyLeaves)
      nLeaves <- arrayLength(leavesArray)
      chunkNumbers <-
        if (nLeaves == 0 || sortedSegmentIds.isEmpty) Fox.successful(sortedSegmentIds.map(_ => -1L))
        else locateLeafChunks(meshFileKey, nInnerNodeLayers, sortedSegmentIds)
      leavesPerChunk = leavesArray.chunkShape(0).toLong
      leafWidth = leavesArray.chunkShape(1)
      chunks <- readChunks[Long](leavesArray, chunkNumbers.filter(_ >= 0).distinct.sorted.toSeq, rank = 2)
    } yield sortedSegmentIds
      .zip(chunkNumbers)
      .flatMap { case (segmentId, chunkNumber) =>
        if (chunkNumber < 0) None
        else {
          val leaves = chunks(chunkNumber)
          val validLeaves = Math.toIntExact(Math.min(leavesPerChunk, nLeaves - chunkNumber * leavesPerChunk))
          val index = ZarrMeshFileService.indexOfLeaf(leaves, leafWidth, validLeaves, segmentId)
          Option.when(index >= 0)(segmentId -> leaves(index * leafWidth + 1))
        }
      }
      .toMap
  }

  // Reads the runs of the data order mapping at level that contain the seed indices, except for runs that are too
  // long for the number of requested segments.
  private def readAgglomerateRuns(meshFileKey: MeshFileKey, seedIndices: Seq[Long], level: Int, requestedCount: Int)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[SegmentMeshMetadata]] =
    for {
      meshMetadataArray <- openZarrArray(meshFileKey, keySegmentMeshMetadata)
      nSegments <- arrayLength(meshMetadataArray)
      maxLevels <- maxSegmentLevelPerChunkCache.getOrLoad(meshFileKey, readMaxSegmentLevelPerChunk)
      segmentsPerChunk = meshMetadataArray.chunkShape(0).toLong
      meshMetadataWidth = meshMetadataArray.chunkShape(1)
      seedSpans = seedIndices
        .map(index => (index, ZarrMeshFileService.runChunkSpan(maxLevels, index / segmentsPerChunk, level)))
        .filter { case (_, (first, last)) =>
          ZarrMeshFileService.runFitsRequest(last - first + 1, segmentsPerChunk, requestedCount)
        }
      chunks <- readChunks[Long](
        meshMetadataArray,
        seedSpans.flatMap { case (_, (first, last)) => first to last }.distinct.sorted,
        rank = 2
      )
    } yield {
      val runs = seedSpans.map { case (seedIndex, (firstChunk, lastChunk)) =>
        ZarrMeshFileService.runAround(chunks, segmentsPerChunk, meshMetadataWidth, nSegments, firstChunk, lastChunk, seedIndex, level)
      }
      runs.distinct.flatMap { case (start, end) =>
        (start until end).map(index =>
          ZarrMeshFileService.segmentMeshMetadataAt(chunks(index / segmentsPerChunk), meshMetadataWidth, index % segmentsPerChunk)
        )
      }
    }

  private def readMaxSegmentLevelPerChunk(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      maxLevelsArray <- openZarrArray(meshFileKey, keyMaxSegmentLevelPerChunk)
      maxLevelsLength <- arrayLength(maxLevelsArray)
      maxLevels <- maxLevelsArray.readAsMultiArray(offset = 0L, shape = Math.toIntExact(maxLevelsLength))
    } yield maxLevels.get1DJavaArray(ucar.ma2.DataType.BYTE).asInstanceOf[Array[Byte]]

  /* Chunks of a uint64 (T = Long) or uint8 (T = Byte) array of rank 1 or 2 by their number along the first axis, each
   * as its values in C order. Whole chunks are read as typed values, which reading a range that is exactly one chunk
   * would not give.
   */
  private def readChunks[T](array: DatasetArray, chunkNumbers: Seq[Long], rank: Int = 1)(using
      ec: ExecutionContext,
      tc: TokenContext,
      elementType: ClassTag[T]
  ): Fox[Map[Long, Array[T]]] = {
    val dataType = if (elementType == ClassTag.Byte) ucar.ma2.DataType.BYTE else ucar.ma2.DataType.LONG
    for {
      chunks <- array.readChunks(
        chunkNumbers.map(chunkNumber => chunkNumber +: Array.fill(rank - 1)(0L)),
        ZarrMeshFileService.maxParallelChunkReads
      )
    } yield chunkNumbers
      .zip(chunks)
      .map { case (chunkNumber, chunk) => chunkNumber -> chunk.get1DJavaArray(dataType).asInstanceOf[Array[T]] }
      .toMap
  }

  // For each sorted segment id, the chunk of the leaves it falls into, or -1 if it is smaller than all segment ids.
  // inner_nodes_0 is the root. With n inner node layers, inner_nodes_{n-1}[c] is the first segment id of chunk c of
  // the leaves and inner_nodes_l[d] the first entry of chunk d of inner_nodes_{l+1}.
  private def locateLeafChunks(meshFileKey: MeshFileKey, nInnerNodeLayers: Int, sortedSegmentIds: Array[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Array[Long]] =
    for {
      rootArray <- openZarrArray(meshFileKey, keyInnerNodes(0))
      rootLength <- arrayLength(rootArray)
      entriesPerChunk = rootArray.chunkShape(0).toLong
      rootChunkNumbers = 0L until (rootLength + entriesPerChunk - 1) / entriesPerChunk
      rootChunks <- readChunks[Long](rootArray, rootChunkNumbers)
      rootEntries = rootChunkNumbers.flatMap(rootChunks(_)).take(Math.toIntExact(rootLength)).toArray
      rootPositions = sortedSegmentIds.map(id =>
        ZarrMeshFileService.lastIndexLessOrEqual(rootEntries, 1, rootEntries.length, id).toLong
      )
      positions <- Fox.foldLeft((1 until nInnerNodeLayers).iterator, rootPositions) {
        (upperLayerPositions, layer) =>
          descendInnerNodeLayer(meshFileKey, layer, upperLayerPositions, sortedSegmentIds)
      }
    } yield positions

  // Positions in inner node layer l-1 are chunk numbers of inner node layer l.
  private def descendInnerNodeLayer(
      meshFileKey: MeshFileKey,
      layer: Int,
      upperLayerPositions: Array[Long],
      sortedSegmentIds: Array[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Long]] =
    for {
      innerNodesArray <- openZarrArray(meshFileKey, keyInnerNodes(layer))
      layerLength <- arrayLength(innerNodesArray)
      entriesPerChunk = innerNodesArray.chunkShape(0).toLong
      entriesByChunk <- readChunks[Long](innerNodesArray, upperLayerPositions.filter(_ >= 0).distinct.sorted.toSeq)
    } yield upperLayerPositions.zip(sortedSegmentIds).map { case (chunkNumber, segmentId) =>
      if (chunkNumber < 0) -1L
      else {
        val chunkStart = chunkNumber * entriesPerChunk
        val validEntries = Math.toIntExact(Math.min(entriesPerChunk, layerLength - chunkStart))
        val indexInChunk =
          ZarrMeshFileService.lastIndexLessOrEqual(entriesByChunk(chunkNumber), 1, validEntries, segmentId)
        if (indexInChunk < 0) -1L else chunkStart + indexInChunk
      }
    }

  // Reads byte ranges [start, end) of a 1-d uint8 array from the chunks they cover.
  private def readByteRanges(array: DatasetArray, ranges: Seq[(Long, Long)])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Array[Byte]]] = {
    val chunkSize = array.chunkShape(0).toLong
    def chunkNumbersOf(start: Long, end: Long) = (start / chunkSize) until ((end + chunkSize - 1) / chunkSize)
    val chunkNumbers = ranges.flatMap(chunkNumbersOf).distinct.sorted
    for {
      bytesByChunk <- readChunks[Byte](array, chunkNumbers)
      rangeBytes <- tryo(ranges.map { case (start, end) =>
        ZarrMeshFileService.copyRange(bytesByChunk, chunkSize, start, end)
      }).toFox
    } yield rangeBytes
  }

  private def arrayLength(array: DatasetArray)(using ec: ExecutionContext): Fox[Long] =
    array.datasetShape.flatMap(_.headOption).toFox ?~> "Could not read array length"

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    maxSegmentLevelPerChunkCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    openArraysCache.clear { case (meshFileKey, _) =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }
  }
}

object ZarrMeshFileService {

  case class SegmentMeshMetadata(segmentId: Long, meshOffset: Long, manifestOffset: Long, manifestLength: Long)

  private val maxParallelChunkReads = 32

  // Columns of the segment mesh metadata.
  private val meshMetadataSegmentId = 0
  private val meshMetadataMeshOffset = 1
  private val meshMetadataManifestOffset = 2
  private val meshMetadataManifestLength = 3
  private val meshMetadataLevel = 4

  // Seeds per round when looking up an agglomerate as runs: an unedited agglomerate is one run, the second
  // round finds the parts of agglomerates of editable mappings.
  val seedCountsPerRound: List[Int] = List(1, 8)

  // A run is read if it spans at most this many segments per requested segment, or at most minRunChunks chunks.
  private val maxRunSegmentsPerRequestedSegment = 4L
  private val minRunChunks = 4L

  private def runFitsRequest(spanChunks: Long, segmentsPerChunk: Long, requestedCount: Int): Boolean =
    spanChunks <= minRunChunks || spanChunks * segmentsPerChunk <= maxRunSegmentsPerRequestedSegment * requestedCount

  private val percentileMappingName = "agglomerate_view_(\\d+)".r

  // The percentile of mappings named like agglomerate_view_90.
  def percentileOfMappingName(mappingName: String): Option[Int] =
    percentileMappingName.findFirstMatchIn(mappingName).flatMap(m => m.group(1).toIntOption)

  def evenlySpaced(values: Array[Long], count: Int): Seq[Long] =
    if (values.length <= count) values.toSeq
    else (0 until count).map(i => values((i.toLong * values.length / count).toInt))

  def segmentMeshMetadataAt(meshMetadataChunk: Array[Long], meshMetadataWidth: Int, indexInChunk: Long): SegmentMeshMetadata = {
    val start = Math.toIntExact(indexInChunk) * meshMetadataWidth
    SegmentMeshMetadata(
      meshMetadataChunk(start + meshMetadataSegmentId),
      meshMetadataChunk(start + meshMetadataMeshOffset),
      meshMetadataChunk(start + meshMetadataManifestOffset),
      meshMetadataChunk(start + meshMetadataManifestLength)
    )
  }

  /** The chunks [first, last] that contain the run of the data order mapping at level around an index in chunk. A
    * run extends over a whole chunk if no segment in it starts a new agglomerate, i.e. if the chunk's maximum segment
    * level is at most level. The run starts in the index's chunk or in the nearest chunk before it that is not passed
    * over whole, and ends in the index's chunk or in the nearest such chunk after it.
    */
  def runChunkSpan(maxSegmentLevelPerChunk: Array[Byte], chunk: Long, level: Int): (Long, Long) = {
    def maxLevelAt(c: Long): Int = maxSegmentLevelPerChunk(Math.toIntExact(c)) & 0xff
    var first = Math.max(chunk - 1, 0)
    while (first > 0 && maxLevelAt(first) <= level) first -= 1
    var last = chunk
    while (last + 1 < maxSegmentLevelPerChunk.length && maxLevelAt(last + 1) <= level) last += 1
    (first, Math.min(last + 1, maxSegmentLevelPerChunk.length - 1L))
  }

  // The run [start, end) of indices around seedIndex within the loaded chunks [firstChunk, lastChunk].
  def runAround(
      chunks: Map[Long, Array[Long]],
      segmentsPerChunk: Long,
      meshMetadataWidth: Int,
      nSegments: Long,
      firstChunk: Long,
      lastChunk: Long,
      seedIndex: Long,
      level: Int
  ): (Long, Long) = {
    def levelAt(index: Long): Long =
      chunks(index / segmentsPerChunk)(Math.toIntExact(index % segmentsPerChunk) * meshMetadataWidth + meshMetadataLevel)
    var start = seedIndex
    while (start > firstChunk * segmentsPerChunk && levelAt(start) <= level) start -= 1
    var end = seedIndex + 1
    val upperBound = Math.min((lastChunk + 1) * segmentsPerChunk, nSegments)
    while (end < upperBound && levelAt(end) <= level) end += 1
    (start, end)
  }

  /* Index of the last of the first `length` sorted values at most segmentId (unsigned), -1 if there is none. Value i is
   * at sortedValues(i * stride), e.g. the first column of a C-ordered table with stride columns.
   */
  def lastIndexLessOrEqual(sortedValues: Array[Long], stride: Int, length: Int, segmentId: Long): Int = {
    var low = 0
    var high = length
    while (low < high) {
      val middle = (low + high) >>> 1
      if (java.lang.Long.compareUnsigned(sortedValues(middle * stride), segmentId) <= 0) low = middle + 1
      else high = middle
    }
    low - 1
  }

  // Index of segmentId among the first validLeaves leaves of a chunk, which are sorted by segment id, -1 if absent.
  def indexOfLeaf(leaves: Array[Long], leafWidth: Int, validLeaves: Int, segmentId: Long): Int = {
    val index = lastIndexLessOrEqual(leaves, leafWidth, validLeaves, segmentId)
    if (index >= 0 && leaves(index * leafWidth) == segmentId) index else -1
  }

  // Assembles the bytes [start, end) from the chunks of a 1-d array.
  def copyRange(bytesByChunk: Map[Long, Array[Byte]], chunkSize: Long, start: Long, end: Long): Array[Byte] = {
    val result = new Array[Byte](Math.toIntExact(end - start))
    var position = start
    while (position < end) {
      val chunkNumber = position / chunkSize
      val offsetInChunk = Math.toIntExact(position - chunkNumber * chunkSize)
      val chunkBytes = bytesByChunk(chunkNumber)
      val length = Math.toIntExact(Math.min(end - position, chunkBytes.length - offsetInChunk))
      if (length <= 0) throw new IllegalArgumentException(s"Byte $position is beyond chunk $chunkNumber")
      System.arraycopy(chunkBytes, offsetInChunk, result, Math.toIntExact(position - start), length)
      position += length
    }
    result
  }
}
