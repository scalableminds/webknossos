package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.box.{Box, EmptyBox, Full}
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
import ZarrMeshFileService.SegmentRow

case class MeshFileAttributes(
    formatVersion: Long,
    meshFormat: String, // AKA encoding (e.g. "draco")
    lodScaleMultiplier: Double,
    transform: Array[Array[Double]],
    hashFunction: Option[String], // Only before format version 10
    nBuckets: Option[Long], // Only before format version 10
    mappingName: Option[String],
    nFenceLevels: Option[Int], // Only from format version 10
    dataOrderMappings: Option[Seq[Int]] // Only from format version 10
) extends ArrayArtifactHashing {
  lazy val applyHashFunction: Option[Long => Long] = hashFunction.map(getHashFunction)

  // From format version 10, segments are looked up in a row table in merge-tree order instead of a hash table.
  def hasRowTable: Boolean = formatVersion >= MeshFileAttributes.minRowTableFormatVersion
}

object MeshFileAttributes extends MeshFileUtils with VoxelyticsZarrArtifactUtils {
  val minRowTableFormatVersion = 10

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
        dataOrderMappings <- (meshFileAttrs \ attrKeyDataOrderMappings).validateOpt[Seq[Int]]
      } yield MeshFileAttributes(
        formatVersion,
        meshFormat,
        lodScaleMultiplier,
        transform,
        hashFunction,
        nBuckets,
        mappingName,
        nFenceLevels,
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
  private lazy val rowLevelSummaryCache = AlfuCache[MeshFileKey, Array[Byte]]()

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

  /** Lists the mesh chunks of the segments. If they were looked up from an agglomerate of dataOrderMappingName (or of
    * an editable mapping based on it), mesh files with a row table find them as runs of rows.
    */
  def listMeshChunksForMultipleSegments(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      dataOrderMappingName: Option[String]
  )(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[WebknossosSegmentInfo] =
    for {
      meshFileAttributes <- readMeshFileAttributes(meshFileKey)
      meshChunksForUnmappedSegments: List[List[MeshLodInfo]] <- listMeshChunksForSegments(
        meshFileKey,
        segmentIds,
        meshFileAttributes,
        dataOrderMappingName
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
      meshFileAttributes: MeshFileAttributes,
      dataOrderMappingName: Option[String]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[List[MeshLodInfo]]] =
    if (meshFileAttributes.hasRowTable)
      listMeshChunksFromRowTable(meshFileKey, segmentIds, meshFileAttributes, dataOrderMappingName)
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
      dataBoxes <- readByteRanges(
        neuroglancerArray,
        meshChunkDataRequests.map(request => (request.byteOffset, request.byteOffset + request.byteSize))
      )
      data <- Fox.combined(dataBoxes.map(_.toFox))
    } yield (Array.concat(data*), meshFileAttributes.meshFormat)

  private def listMeshChunksFromRowTable(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      meshFileAttributes: MeshFileAttributes,
      dataOrderMappingName: Option[String]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[List[MeshLodInfo]]] = {
    val level = for {
      mappingName <- dataOrderMappingName
      percentile <- ZarrMeshFileService.percentileOfMappingName(mappingName)
      mappings <- meshFileAttributes.dataOrderMappings
      level = mappings.indexOf(percentile)
      if level >= 0
    } yield level
    for {
      _ <- prepareRowTableArrays(meshFileKey, meshFileAttributes)
      allRows <- level match {
        case Some(l) if segmentIds.distinct.length > 1 =>
          lookUpRowsByAgglomerateRuns(meshFileKey, meshFileAttributes, segmentIds, l)
        case _ => lookUpRowsBySegmentIds(meshFileKey, meshFileAttributes, segmentIds)
      }
      // Segments without a mesh have empty rows.
      rows = allRows.filter(_.manifestLength > 0)
      manifestsArray <- openZarrArray(meshFileKey, keyManifests)
      manifestBoxes <- readByteRanges(
        manifestsArray,
        rows.map(row => (row.manifestOffset, row.manifestOffset + row.manifestLength))
      )
    } yield rows.zip(manifestBoxes).toList.flatMap { case (row, manifestBox) =>
      // Segments whose manifest cannot be read are left out.
      manifestBox
        .flatMap(manifestBytes => tryo(NeuroglancerSegmentManifest.fromBytes(manifestBytes)))
        .map(segmentManifest =>
          enrichSegmentInfoWithMeshStart(
            segmentManifest,
            meshFileAttributes.lodScaleMultiplier,
            meshFileAttributes.transform,
            row.meshOffset,
            row.segmentId
          )
        )
        .toOption
    }
  }

  /* Opens the arrays and reads the row level summary in parallel, so that the first lookup in a mesh file does not
   * open them one after the other. Failures only show up later, where the data is needed.
   */
  private def prepareRowTableArrays(meshFileKey: MeshFileKey, meshFileAttributes: MeshFileAttributes)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Unit] = {
    val arrayNames = Seq(keyIdIndex, keyRows, keyRowLevelSummary, keyManifests, keyNeuroglancer) ++
      meshFileAttributes.nFenceLevels.map(levels => (0 until levels).map(keyFence)).getOrElse(Seq.empty)
    for {
      _ <- Fox.combined(
        arrayNames.map(arrayName => openZarrArray(meshFileKey, arrayName).shiftBox.map(_ => ())) :+
          rowLevelSummaryCache.getOrLoad(meshFileKey, readRowLevelSummary).shiftBox.map(_ => ())
      )
    } yield ()
  }

  /* The segments of an agglomerate of a data order mapping form one run of rows. Runs are found from a few seed
   * segments and only rows of the requested segments are kept, so that agglomerates of editable mappings, which are
   * unions of parts of such agglomerates, are found as well. Runs that are much longer than the request, e.g. of a
   * large agglomerate that a few requested segments were split off from, are not read. Segments that no read run
   * covers are looked up individually.
   */
  private def lookUpRowsByAgglomerateRuns(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long],
      level: Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[SegmentRow]] = {
    val requested = segmentIds.toSet
    def lookUpRounds(seedCounts: List[Int], remaining: Set[Long], found: Seq[SegmentRow]): Fox[Seq[SegmentRow]] =
      seedCounts match {
        case seedCount :: laterSeedCounts if remaining.nonEmpty =>
          val sortedRemaining = remaining.toArray.sortWith(java.lang.Long.compareUnsigned(_, _) < 0)
          val seeds = ZarrMeshFileService.evenlySpaced(sortedRemaining, seedCount)
          for {
            seedRows <- lookUpRowNumbers(meshFileKey, meshFileAttributes, seeds)
            runRows <- readAgglomerateRuns(meshFileKey, seedRows.values.toSeq.distinct, level, requested.size)
            newRows = runRows.filter(row => remaining.contains(row.segmentId))
            // Seeds without a mesh are not looked up again.
            notFound = seeds.filterNot(seedRows.contains).toSet
            result <- lookUpRounds(
              laterSeedCounts,
              remaining -- newRows.map(_.segmentId) -- notFound,
              found ++ newRows
            )
          } yield result
        case _ =>
          for {
            remainingRows <- lookUpRowsBySegmentIds(meshFileKey, meshFileAttributes, remaining.toSeq)
          } yield found ++ remainingRows
      }
    lookUpRounds(ZarrMeshFileService.seedCountsPerRound, requested, Seq.empty)
  }

  private def lookUpRowsBySegmentIds(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[SegmentRow]] =
    for {
      rowNumbers <- lookUpRowNumbers(meshFileKey, meshFileAttributes, segmentIds)
      rowsArray <- openZarrArray(meshFileKey, keyRows)
      rowsPerChunk = rowsArray.chunkShape(0).toLong
      chunks <- readTableChunks(rowsArray, rowNumbers.values.map(_ / rowsPerChunk).toSeq.distinct.sorted)
    } yield rowNumbers.values.toSeq.sorted.map { rowNumber =>
      ZarrMeshFileService.segmentRowAt(
        chunks(rowNumber / rowsPerChunk),
        rowsArray.chunkShape(1),
        rowNumber % rowsPerChunk
      )
    }

  // The row of each segment id that has a mesh, looked up in the id index.
  private def lookUpRowNumbers(
      meshFileKey: MeshFileKey,
      meshFileAttributes: MeshFileAttributes,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Map[Long, Long]] = {
    val sortedSegmentIds = segmentIds.distinct.sortWith(java.lang.Long.compareUnsigned(_, _) < 0).toArray
    for {
      nFenceLevels <- meshFileAttributes.nFenceLevels.toFox ?~> "Mesh file has no fence levels"
      idIndexArray <- openZarrArray(meshFileKey, keyIdIndex)
      idIndexLength <- arrayLength(idIndexArray)
      chunkNumbers <-
        if (idIndexLength == 0 || sortedSegmentIds.isEmpty) Fox.successful(sortedSegmentIds.map(_ => -1L))
        else locateIndexChunks(meshFileKey, nFenceLevels, sortedSegmentIds)
      rowsPerChunk = idIndexArray.chunkShape(0).toLong
      rowWidth = idIndexArray.chunkShape(1)
      chunks <- readTableChunks(idIndexArray, chunkNumbers.filter(_ >= 0).distinct.sorted.toSeq)
    } yield sortedSegmentIds
      .zip(chunkNumbers)
      .flatMap { case (segmentId, chunkNumber) =>
        if (chunkNumber < 0) None
        else {
          val table = chunks(chunkNumber)
          val validRows = Math.toIntExact(Math.min(rowsPerChunk, idIndexLength - chunkNumber * rowsPerChunk))
          val row = ZarrMeshFileService.indexOfRow(table, rowWidth, validRows, segmentId)
          Option.when(row >= 0)(segmentId -> table(row * rowWidth + 1))
        }
      }
      .toMap
  }

  // Reads the runs of rows of the data order mapping at level that contain the seed rows, except for runs that are
  // too long for the number of requested segments.
  private def readAgglomerateRuns(meshFileKey: MeshFileKey, seedRows: Seq[Long], level: Int, requestedCount: Int)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[SegmentRow]] =
    for {
      rowsArray <- openZarrArray(meshFileKey, keyRows)
      rowsLength <- arrayLength(rowsArray)
      summary <- rowLevelSummaryCache.getOrLoad(meshFileKey, readRowLevelSummary)
      rowsPerChunk = rowsArray.chunkShape(0).toLong
      rowWidth = rowsArray.chunkShape(1)
      seedSpans = seedRows
        .map(row => (row, ZarrMeshFileService.runChunkSpan(summary, row / rowsPerChunk, level)))
        .filter { case (_, (first, last)) =>
          ZarrMeshFileService.runFitsRequest(last - first + 1, rowsPerChunk, requestedCount)
        }
      chunks <- readTableChunks(
        rowsArray,
        seedSpans.flatMap { case (_, (first, last)) => first to last }.distinct.sorted
      )
    } yield {
      val runs = seedSpans.map { case (seedRow, (firstChunk, lastChunk)) =>
        ZarrMeshFileService.runAround(chunks, rowsPerChunk, rowWidth, rowsLength, firstChunk, lastChunk, seedRow, level)
      }
      runs.distinct.flatMap { case (start, end) =>
        (start until end).map(row =>
          ZarrMeshFileService.segmentRowAt(chunks(row / rowsPerChunk), rowWidth, row % rowsPerChunk)
        )
      }
    }

  private def readRowLevelSummary(
      meshFileKey: MeshFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      summaryArray <- openZarrArray(meshFileKey, keyRowLevelSummary)
      summaryLength <- arrayLength(summaryArray)
      summary <- summaryArray.readAsMultiArray(offset = 0L, shape = Math.toIntExact(summaryLength))
    } yield summary.get1DJavaArray(ucar.ma2.DataType.BYTE).asInstanceOf[Array[Byte]]

  private def readAllChunks(array: DatasetArray, chunkIndices: Seq[Array[Long]])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[MultiArray]] =
    for {
      chunkBoxes <- array.readChunks(chunkIndices, ZarrMeshFileService.maxParallelChunkReads)
      chunks <- Fox.combined(chunkBoxes.map(_.toFox))
    } yield chunks

  // Chunks of a 2-d uint64 table by chunk number, each as its values in C order.
  private def readTableChunks(array: DatasetArray, chunkNumbers: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Map[Long, Array[Long]]] =
    for {
      chunks <- readAllChunks(array, chunkNumbers.map(chunkNumber => Array(chunkNumber, 0L)))
    } yield chunkNumbers
      .zip(chunks)
      .map { case (chunkNumber, chunk) =>
        chunkNumber -> chunk.get1DJavaArray(ucar.ma2.DataType.LONG).asInstanceOf[Array[Long]]
      }
      .toMap

  // For each sorted segment id, the id index chunk it falls into, or -1 if it is smaller than all indexed ids.
  // fence_0[c] is the first segment id of id index chunk c and fence_{l+1}[d] the first entry of chunk d of fence_l.
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
      chunks <- readAllChunks(fenceArray, chunkNumbers.toSeq.map(chunkNumber => Array(chunkNumber)))
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

  // Reads byte ranges [start, end) of a 1-d uint8 array, combining the reads of the chunks they cover. A range fails
  // if one of its chunks cannot be read.
  private def readByteRanges(array: DatasetArray, ranges: Seq[(Long, Long)])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Box[Array[Byte]]]] = {
    val chunkSize = array.chunkShape(0).toLong
    def chunkNumbersOf(start: Long, end: Long) = (start / chunkSize) until ((end + chunkSize - 1) / chunkSize)
    val chunkNumbers = ranges.flatMap(chunkNumbersOf).distinct.sorted
    for {
      chunkBoxes <- array.readChunks(
        chunkNumbers.map(chunkNumber => Array(chunkNumber)),
        ZarrMeshFileService.maxParallelChunkReads
      )
      boxByChunk = chunkNumbers.zip(chunkBoxes).toMap
      bytesByChunk = boxByChunk.collect { case (chunkNumber, Full(chunk)) =>
        chunkNumber -> chunk.get1DJavaArray(ucar.ma2.DataType.BYTE).asInstanceOf[Array[Byte]]
      }
    } yield ranges.map { case (start, end) =>
      chunkNumbersOf(start, end)
        .map(boxByChunk)
        .collectFirst { case failed: EmptyBox => failed }
        .getOrElse(tryo(ZarrMeshFileService.copyRange(bytesByChunk, chunkSize, start, end)))
    }
  }

  private def arrayLength(array: DatasetArray)(using ec: ExecutionContext): Fox[Long] =
    array.datasetShape.flatMap(_.headOption).toFox ?~> "Could not read array length"

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    rowLevelSummaryCache.clear { meshFileKey =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }

    openArraysCache.clear { case (meshFileKey, _) =>
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    }
  }
}

object ZarrMeshFileService {

  case class SegmentRow(segmentId: Long, meshOffset: Long, manifestOffset: Long, manifestLength: Long)

  private val maxParallelChunkReads = 32

  // Columns of the row table.
  private val rowSegmentId = 0
  private val rowMeshOffset = 1
  private val rowManifestOffset = 2
  private val rowManifestLength = 3
  private val rowLevel = 4

  // Seeds per round when looking up an agglomerate as runs of rows: an unedited agglomerate is one run, the second
  // round finds the parts of agglomerates of editable mappings.
  val seedCountsPerRound: List[Int] = List(1, 8)

  // A run is read if it spans at most this many rows per requested segment, or at most minRunChunks chunks.
  private val maxRunRowsPerRequestedSegment = 4L
  private val minRunChunks = 4L

  def runFitsRequest(spanChunks: Long, rowsPerChunk: Long, requestedCount: Int): Boolean =
    spanChunks <= minRunChunks || spanChunks * rowsPerChunk <= maxRunRowsPerRequestedSegment * requestedCount

  // The percentile of mappings named like agglomerate_view_90.
  def percentileOfMappingName(mappingName: String): Option[Int] =
    "agglomerate_view_(\\d+)".r.findFirstMatchIn(mappingName).flatMap(m => m.group(1).toIntOption)

  def evenlySpaced(sortedValues: Array[Long], count: Int): Seq[Long] =
    if (sortedValues.length <= count) sortedValues.toSeq
    else (0 until count).map(i => sortedValues((i.toLong * sortedValues.length / count).toInt))

  def segmentRowAt(table: Array[Long], rowWidth: Int, rowInChunk: Long): SegmentRow = {
    val start = Math.toIntExact(rowInChunk) * rowWidth
    SegmentRow(
      table(start + rowSegmentId),
      table(start + rowMeshOffset),
      table(start + rowManifestOffset),
      table(start + rowManifestLength)
    )
  }

  /** The chunks [first, last] that contain the run of the data order mapping at level around a row in chunk. A run
    * extends over a whole chunk if no row in it starts a new agglomerate, i.e. if the chunk's maximum level is at most
    * level. The run starts in the row's chunk or in the nearest chunk before it that is not passed over whole, and ends
    * in the row's chunk or in the nearest such chunk after it.
    */
  def runChunkSpan(levelSummary: Array[Byte], chunk: Long, level: Int): (Long, Long) = {
    def summaryAt(c: Long): Int = levelSummary(Math.toIntExact(c)) & 0xff
    var first = Math.max(chunk - 1, 0)
    while (first > 0 && summaryAt(first) <= level) first -= 1
    var last = chunk
    while (last + 1 < levelSummary.length && summaryAt(last + 1) <= level) last += 1
    (first, Math.min(last + 1, levelSummary.length - 1L))
  }

  // The run [start, end) of rows around seedRow within the loaded chunks [firstChunk, lastChunk].
  def runAround(
      chunks: Map[Long, Array[Long]],
      rowsPerChunk: Long,
      rowWidth: Int,
      rowsLength: Long,
      firstChunk: Long,
      lastChunk: Long,
      seedRow: Long,
      level: Int
  ): (Long, Long) = {
    def levelAt(row: Long): Long = chunks(row / rowsPerChunk)(Math.toIntExact(row % rowsPerChunk) * rowWidth + rowLevel)
    var start = seedRow
    while (start > firstChunk * rowsPerChunk && levelAt(start) <= level) start -= 1
    var end = seedRow + 1
    val upperBound = Math.min((lastChunk + 1) * rowsPerChunk, rowsLength)
    while (end < upperBound && levelAt(end) <= level) end += 1
    (start, end)
  }

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
