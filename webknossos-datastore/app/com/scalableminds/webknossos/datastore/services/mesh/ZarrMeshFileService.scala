package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datareaders.{ChunkReadCoalescing, DatasetArray}
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

case class MeshFileAttributes(
    formatVersion: Long,
    meshFormat: String, // AKA encoding (e.g. "draco")
    lodScaleMultiplier: Double,
    transform: Array[Array[Double]],
    hashFunction: Option[String], // Only before format version 10
    nBuckets: Option[Long], // Only before format version 10
    mappingName: Option[String],
    nFenceLevels: Option[Int] // Only from format version 10
) extends ArrayArtifactHashing {
  lazy val applyHashFunction: Option[Long => Long] = hashFunction.map(getHashFunction)

  // From format version 10, segments are looked up in an index sorted by segment id instead of a hash table.
  def hasSegmentIndex: Boolean = formatVersion >= MeshFileAttributes.minSegmentIndexFormatVersion
}

object MeshFileAttributes extends MeshFileUtils with VoxelyticsZarrArtifactUtils {
  val minSegmentIndexFormatVersion = 10

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
        nFenceLevels <- (meshFileAttrs \ attrKeyNFenceLevels).validateOpt[Int]
      } yield MeshFileAttributes(
        formatVersion,
        meshFormat,
        lodScaleMultiplier,
        transform,
        hashFunction,
        nBuckets,
        mappingName,
        nFenceLevels
      )
    }
  }
}

class ZarrMeshFileService @Inject() (
    chunkCacheService: DSChunkCacheService,
    dataVaultService: DataVaultService,
    config: DataStoreConfig
) extends MeshFileUtils
    with NeuroglancerMeshHelper {

  private lazy val coalescing = ChunkReadCoalescing(
    maxGapBytes = config.Datastore.MeshFile.maxGapBytes,
    maxRequestBytes = config.Datastore.MeshFile.maxRequestBytes,
    maxParallelRequests = config.Datastore.MeshFile.maxParallelRequests
  )

  private lazy val openArraysCache = AlfuCache[(MeshFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[MeshFileKey, MeshFileAttributes]()

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

  def listMeshChunksForSegment(meshFileKey: MeshFileKey, segmentId: Long, meshFileAttributes: MeshFileAttributes)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[List[MeshLodInfo]] =
    for {
      (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) <- getNeuroglancerSegmentManifestOffsets(
        meshFileKey,
        meshFileAttributes,
        segmentId
      )
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      manifestBytes <- neuroglancerArray.readAsMultiArray(
        offset = neuroglancerSegmentManifestStart,
        shape = (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt
      )
      segmentManifest <- tryo(
        NeuroglancerSegmentManifest.fromBytes(manifestBytes.getStorage.asInstanceOf[Array[Byte]])
      ).toFox
    } yield enrichSegmentInfo(
      segmentManifest,
      meshFileAttributes.lodScaleMultiplier,
      meshFileAttributes.transform,
      neuroglancerSegmentManifestStart,
      segmentId
    )

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
      _ <- Fox.fromBool(bucketSize > 0) ?~> s"No entry for segment $segmentId"
      bucketsArray <- openZarrArray(meshFileKey, keyBuckets)
      bucket <- bucketsArray.readAsMultiArray(offset = Array(bucketStart, 0), shape = Array(bucketSize + 1, 3))
      bucketLocalOffset <- findLocalOffsetInBucket(
        bucket,
        segmentId
      ).toFox ?~> s"SegmentId $segmentId not in bucket list"
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

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[WebknossosSegmentInfo] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
      meshChunksForUnmappedSegments: List[List[MeshLodInfo]] <- listMeshChunksForSegments(
        meshFileKey,
        segmentIds,
        meshFileAttributes
      ) ?~> Msg.Mesh.File.listChunksFailed(segmentIds.mkString(","), meshFileKey.attachment.name)
      _ <- Fox.fromBool(meshChunksForUnmappedSegments.nonEmpty) ?~> Msg.Mesh.File
        .zeroChunks(segmentIds.mkString(","), meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo
        .fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, meshFileAttributes.meshFormat)
        .toFox
    } yield wkChunkInfos

  private def listMeshChunksForSegments(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[List[MeshLodInfo]]] =
    if (meshFileAttributes.hasSegmentIndex) listMeshChunksFromSegmentIndex(meshFileKey, segmentIds, meshFileAttributes)
    else listMeshChunksForSegmentsNested(meshFileKey, segmentIds, meshFileAttributes)

  private def listMeshChunksForSegmentsNested(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[List[MeshLodInfo]]] = {
    def lookupOne(segmentId: Long): Fox[Option[List[MeshLodInfo]]] =
      listMeshChunksForSegment(meshFileKey, segmentId, meshFileAttributes).map(Some(_)).orElse(Fox.successful(None))
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

  private case class SegmentIndexRow(segmentId: Long, meshStart: Long, manifestStart: Long, manifestEnd: Long)

  private def listMeshChunksFromSegmentIndex(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[List[MeshLodInfo]]] =
    for {
      rows <- lookUpSegmentIndexRows(meshFileKey, meshFileAttributes, segmentIds)
      neuroglancerArray <- openZarrArray(meshFileKey, keyNeuroglancer)
      manifests <- readByteRanges(neuroglancerArray, rows.map(row => (row.manifestStart, row.manifestEnd)))
      meshInfos <- Fox.serialCombined(rows.zip(manifests)) { case (row, manifestBytes) =>
        for {
          segmentManifest <- tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes)).toFox
        } yield enrichSegmentInfo(
          segmentManifest,
          meshFileAttributes.lodScaleMultiplier,
          meshFileAttributes.transform,
          row.manifestStart,
          row.segmentId
        )
      }
    } yield meshInfos

  // Segments without a mesh are left out.
  private def lookUpSegmentIndexRows(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[SegmentIndexRow]] = {
    val sortedSegmentIds = segmentIds.distinct.sortWith(java.lang.Long.compareUnsigned(_, _) < 0).toArray
    for {
      nFenceLevels <- meshFileAttributes.nFenceLevels.toFox ?~> "Mesh file has no fence levels"
      indexArray <- openZarrArray(meshFileKey, keyIndex)
      indexLength <- arrayLength(indexArray)
      indexChunkNumbers <-
        if (indexLength == 0 || sortedSegmentIds.isEmpty) Fox.successful(sortedSegmentIds.map(_ => -1L))
        else locateIndexChunks(meshFileKey, nFenceLevels, sortedSegmentIds)
      rows <- readSegmentIndexRows(indexArray, indexLength, sortedSegmentIds, indexChunkNumbers)
    } yield rows
  }

  // For each sorted segment id, the index chunk it falls into, or -1 if it is smaller than all indexed ids.
  // fence_0[c] is the first segment id of index chunk c and fence_{l+1}[d] the first entry of chunk d of fence_l.
  private def locateIndexChunks(meshFileKey: MeshFileKey, nFenceLevels: Int, sortedSegmentIds: Array[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Array[Long]] =
    for {
      topLevelArray <- openZarrArray(meshFileKey, keyFence(nFenceLevels - 1))
      topLevelLength <- arrayLength(topLevelArray)
      topLevel <- topLevelArray.readAsMultiArray(offset = 0L, shape = Math.toIntExact(topLevelLength))
      topLevelEntries = topLevel.get1DJavaArray(ucar.ma2.DataType.LONG).asInstanceOf[Array[Long]]
      topLevelPositions = sortedSegmentIds.map(id =>
        ZarrMeshFileService.lastIndexLessOrEqual(topLevelEntries, topLevelEntries.length, id).toLong
      )
      positions <- Fox.foldLeft((nFenceLevels - 1 to 1 by -1).iterator, topLevelPositions) {
        (upperLevelPositions, level) =>
          descendFenceLevel(meshFileKey, level - 1, upperLevelPositions, sortedSegmentIds)
      }
    } yield positions

  // Positions in fence level l+1 are chunk numbers of fence level l.
  private def descendFenceLevel(
      meshFileKey: MeshFileKey,
      level: Int,
      upperLevelPositions: Array[Long],
      sortedSegmentIds: Array[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Long]] =
    for {
      fenceArray <- openZarrArray(meshFileKey, keyFence(level))
      fenceLength <- arrayLength(fenceArray)
      entriesPerChunk = fenceArray.chunkShape(0).toLong
      chunkNumbers = upperLevelPositions.filter(_ >= 0).distinct.sorted
      chunks <- fenceArray.readChunks(chunkNumbers.toSeq.map(chunkNumber => Array(chunkNumber)), coalescing)
      entriesByChunk = chunkNumbers
        .zip(chunks)
        .map { case (chunkNumber, chunk) =>
          chunkNumber -> chunk.get1DJavaArray(ucar.ma2.DataType.LONG).asInstanceOf[Array[Long]]
        }
        .toMap
    } yield upperLevelPositions.zip(sortedSegmentIds).map { case (chunkNumber, segmentId) =>
      if (chunkNumber < 0) -1L
      else {
        val chunkStart = chunkNumber * entriesPerChunk
        val validEntries = Math.toIntExact(Math.min(entriesPerChunk, fenceLength - chunkStart))
        val indexInChunk =
          ZarrMeshFileService.lastIndexLessOrEqual(entriesByChunk(chunkNumber), validEntries, segmentId)
        if (indexInChunk < 0) -1L else chunkStart + indexInChunk
      }
    }

  private def readSegmentIndexRows(
      indexArray: DatasetArray,
      indexLength: Long,
      sortedSegmentIds: Array[Long],
      indexChunkNumbers: Array[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[SegmentIndexRow]] = {
    val rowsPerChunk = indexArray.chunkShape(0).toLong
    val rowWidth = indexArray.chunkShape(1)
    val chunkNumbers = indexChunkNumbers.filter(_ >= 0).distinct.sorted
    for {
      chunks <- indexArray.readChunks(chunkNumbers.toSeq.map(chunkNumber => Array(chunkNumber, 0L)), coalescing)
      // Chunks are stored in C order: row r, column c is at r * rowWidth + c.
      rowsByChunk = chunkNumbers
        .zip(chunks)
        .map { case (chunkNumber, chunk) =>
          chunkNumber -> chunk.get1DJavaArray(ucar.ma2.DataType.LONG).asInstanceOf[Array[Long]]
        }
        .toMap
    } yield sortedSegmentIds.zip(indexChunkNumbers).toSeq.flatMap { case (segmentId, chunkNumber) =>
      if (chunkNumber < 0) None
      else {
        val table = rowsByChunk(chunkNumber)
        val validRows = Math.toIntExact(Math.min(rowsPerChunk, indexLength - chunkNumber * rowsPerChunk))
        val row = ZarrMeshFileService.indexOfRow(table, rowWidth, validRows, segmentId)
        Option.when(row >= 0)(
          SegmentIndexRow(
            segmentId,
            table(row * rowWidth + 1),
            table(row * rowWidth + 2),
            table(row * rowWidth + 3)
          )
        )
      }
    }
  }

  // Reads byte ranges [start, end) of a 1-d uint8 array, combining the reads of the chunks they cover.
  private def readByteRanges(array: DatasetArray, ranges: Seq[(Long, Long)])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Array[Byte]]] = {
    val chunkSize = array.chunkShape(0).toLong
    val chunkNumbers = ranges.filter { case (start, end) => end > start }.flatMap { case (start, end) =>
      (start / chunkSize) to ((end - 1) / chunkSize)
    }.distinct.sorted
    for {
      chunks <- array.readChunks(chunkNumbers.map(chunkNumber => Array(chunkNumber)), coalescing)
      bytesByChunk = chunkNumbers
        .zip(chunks)
        .map { case (chunkNumber, chunk) =>
          chunkNumber -> chunk.get1DJavaArray(ucar.ma2.DataType.BYTE).asInstanceOf[Array[Byte]]
        }
        .toMap
      rangeBytes <- Fox.serialCombined(ranges) { case (start, end) =>
        tryo(ZarrMeshFileService.copyRange(bytesByChunk, chunkSize, start, end)).toFox
      }
    } yield rangeBytes
  }

  private def arrayLength(array: DatasetArray)(using ec: ExecutionContext): Fox[Long] =
    array.datasetShape.flatMap(_.headOption).toFox ?~> "Could not read array length"

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    openArraysCache.clear { case (meshFileKey, _) =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }
  }
}

object ZarrMeshFileService {

  // Index of the last of the first `length` sorted values that is at most segmentId (unsigned), -1 if there is none.
  def lastIndexLessOrEqual(sortedValues: Array[Long], length: Int, segmentId: Long): Int = {
    var low = 0
    var high = length
    while (low < high) {
      val middle = (low + high) >>> 1
      if (java.lang.Long.compareUnsigned(sortedValues(middle), segmentId) <= 0) low = middle + 1
      else high = middle
    }
    low - 1
  }

  // Row of segmentId among the first validRows rows of a C-ordered table sorted by its first column, -1 if absent.
  def indexOfRow(table: Array[Long], rowWidth: Int, validRows: Int, segmentId: Long): Int = {
    val row = lastIndexLessOrEqualInColumn(table, rowWidth, validRows, segmentId)
    if (row >= 0 && table(row * rowWidth) == segmentId) row else -1
  }

  private def lastIndexLessOrEqualInColumn(table: Array[Long], rowWidth: Int, validRows: Int, segmentId: Long): Int = {
    var low = 0
    var high = validRows
    while (low < high) {
      val middle = (low + high) >>> 1
      if (java.lang.Long.compareUnsigned(table(middle * rowWidth), segmentId) <= 0) low = middle + 1
      else high = middle
    }
    low - 1
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
