package com.scalableminds.webknossos.datastore.services

import ch.systemsx.cisd.hdf5._
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, SkeletonTracing, Tree, TreeTypeProto}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NativeBucketScanner, NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.common.Box.tryo
import org.apache.commons.io.FilenameUtils
import ucar.ma2.{DataType, Array => MultiArray}

import java.net.URI
import java.nio._
import java.nio.file.{Files, Paths}
import javax.inject.Inject
import scala.annotation.tailrec
import scala.collection.compat.immutable.ArraySeq
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class ZarrAgglomerateService @Inject()(config: DataStoreConfig, dataVaultService: DataVaultService)
    extends DataConverter
    with LazyLogging {
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val agglomerateDir = "agglomerates"

  // TODO clear on dataset reload
  private lazy val openArraysCache = AlfuCache[(AgglomerateFileKey, String), DatasetArray]()

  // TODO unify with existing chunkContentsCache from binaryDataService?
  private lazy val sharedChunkContentsCache: AlfuCache[String, MultiArray] = {
    // Used by DatasetArray-based datasets. Measure item weight in kilobytes because the weigher can only return int, not long

    val maxSizeKiloBytes = Math.floor(config.Datastore.Cache.ImageArrayChunks.maxSizeBytes.toDouble / 1000.0).toInt

    def cacheWeight(key: String, arrayBox: Box[MultiArray]): Int =
      arrayBox match {
        case Full(array) =>
          (array.getSizeBytes / 1000L).toInt
        case _ => 0
      }

    AlfuCache(maxSizeKiloBytes, weighFn = Some(cacheWeight))
  }

  protected lazy val bucketScanner = new NativeBucketScanner()

  private def mapSingleSegment(segmentToAgglomerate: DatasetArray, segmentId: Long)(implicit ec: ExecutionContext,
                                                                                    tc: TokenContext): Fox[Long] =
    for {
      asMultiArray <- segmentToAgglomerate.readAsMultiArray(shape = Array(1), offset = Array(segmentId))
    } yield asMultiArray.getLong(0)

  private def openZarrArrayCached(agglomerateFileKey: AgglomerateFileKey,
                                  zarrArrayName: String)(implicit ec: ExecutionContext, tc: TokenContext) =
    openArraysCache.getOrLoad((agglomerateFileKey, zarrArrayName),
                              _ => openZarrArray(agglomerateFileKey, zarrArrayName))

  private def openZarrArray(agglomerateFileKey: AgglomerateFileKey, zarrArrayName: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[DatasetArray] = {

    val zarrGroupPath = agglomerateFileKey.zarrGroupPath(dataBaseDir, agglomerateDir).toAbsolutePath
    for {
      groupVaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(s"file://$zarrGroupPath"), None))
      segmentToAgglomeratePath = groupVaultPath / zarrArrayName
      zarrArray <- Zarr3Array.open(segmentToAgglomeratePath,
                                   DataSourceId("zarr", "test"),
                                   "layer",
                                   None,
                                   None,
                                   None,
                                   sharedChunkContentsCache)
    } yield zarrArray
  }

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte])(implicit ec: ExecutionContext,
                                                                           tc: TokenContext): Fox[Array[Byte]] = {

    val agglomerateFileKey = AgglomerateFileKey.fromDataRequest(request)

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

    val bytesPerElement = ElementClass.bytesPerElement(request.dataLayer.elementClass)
    val distinctSegmentIds =
      bucketScanner.collectSegmentIds(data, bytesPerElement, isSigned = false, skipZeroes = false)

    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileKey, "segment_to_agglomerate")
      beforeBuildMap = Instant.now
      relevantAgglomerateMap: Map[Long, Long] <- Fox
        .serialCombined(distinctSegmentIds) { segmentId =>
          mapSingleSegment(segmentToAgglomerate, segmentId).map((segmentId, _))
        }
        .map(_.toMap)
      _ = Instant.logSince(beforeBuildMap, "build map")
      mappedBytes: Array[Byte] = convertData(data, request.dataLayer.elementClass) match {
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

  def generateSkeleton(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String,
                       mappingName: String,
                       agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[SkeletonTracing] =
    for {
      before <- Instant.nowFox
      agglomerateFileKey = AgglomerateFileKey(organizationId, datasetDirectoryName, dataLayerName, mappingName)
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments_offsets")
      agglomerateToEdgesOffsets <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_edges_offsets")

      positionsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = Array(agglomerateId),
                                                                                  shape = Array(2))
      edgesRange: MultiArray <- agglomerateToEdgesOffsets.readAsMultiArray(offset = Array(agglomerateId),
                                                                           shape = Array(2))
      nodeCount = positionsRange.getLong(1) - positionsRange.getLong(0)
      edgeCount = edgesRange.getLong(1) - edgesRange.getLong(0)
      edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
      _ <- Fox.fromBool(nodeCount <= edgeLimit) ?~> s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)"
      _ <- Fox.fromBool(edgeCount <= edgeLimit) ?~> s"Agglomerate has too many edges ($edgeCount > $edgeLimit)"
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_positions")
      positions <- agglomerateToPositions.readAsMultiArray(offset = Array(positionsRange.getLong(0), 0),
                                                           shape = Array(nodeCount.toInt, 3))
      agglomerateToEdges <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_edges")
      edges: MultiArray <- agglomerateToEdges.readAsMultiArray(offset = Array(edgesRange.getLong(0), 0),
                                                               shape = Array(edgeCount.toInt, 2))
      nodeIdStartAtOneOffset = 1

      // TODO use multiarray index iterators?
      nodes = (0 until nodeCount.toInt).map { nodeIdx =>
        NodeDefaults.createInstance.copy(
          id = nodeIdx + nodeIdStartAtOneOffset,
          position = Vec3IntProto(
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 0))),
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 1))),
            positions.getInt(positions.getIndex.set(Array(nodeIdx, 2)))
          )
        )
      }

      skeletonEdges = (0 until edges.getShape()(0)).map { edgeIdx =>
        Edge(
          source = edges.getInt(edges.getIndex.set(Array(edgeIdx, 0))) + nodeIdStartAtOneOffset,
          target = edges.getInt(edges.getIndex.set(Array(edgeIdx, 1))) + nodeIdStartAtOneOffset
        )
      }

      trees = Seq(
        Tree(
          treeId = math.abs(agglomerateId.toInt), // used only to deterministically select tree color
          createdTimestamp = System.currentTimeMillis(),
          // unsafeWrapArray is fine, because the underlying arrays are never mutated
          nodes = nodes,
          edges = skeletonEdges,
          name = s"agglomerate $agglomerateId ($mappingName)",
          `type` = Some(TreeTypeProto.AGGLOMERATE)
        ))

      skeleton = SkeletonTracingDefaults.createInstance.copy(
        datasetName = datasetDirectoryName,
        trees = trees
      )

      _ = if (Instant.since(before) > (100 milliseconds)) {
        Instant.logSince(
          before,
          s"Generating skeleton from agglomerate file with ${skeletonEdges.length} edges, ${nodes.length} nodes",
          logger)
      }

    } yield skeleton

  def largestAgglomerateId(agglomerateFileKey: AgglomerateFileKey)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[Long] =
    for {
      array <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments_offsets")
      shape <- array.datasetShape.toFox ?~> "Could not determine array shape"
      shapeFirstElement <- tryo(shape(0)).toFox
    } yield shapeFirstElement

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AgglomerateGraph] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments_offsets")
      agglomerateToEdgesOffsets <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_edges_offsets")

      positionsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(shape = Array(2),
                                                                                  offset = Array(agglomerateId))
      edgesRange: MultiArray <- agglomerateToEdgesOffsets.readAsMultiArray(shape = Array(2),
                                                                           offset = Array(agglomerateId))
      nodeCount = positionsRange.getLong(1) - positionsRange.getLong(0)
      edgeCount = edgesRange.getLong(1) - edgesRange.getLong(0)
      edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
      _ <- Fox.fromBool(nodeCount <= edgeLimit) ?~> s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)"
      _ <- Fox.fromBool(edgeCount <= edgeLimit) ?~> s"Agglomerate has too many edges ($edgeCount > $edgeLimit)"
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_positions")
      positions: MultiArray <- agglomerateToPositions.readAsMultiArray(offset = Array(positionsRange.getLong(0), 0),
                                                                       shape = Array(nodeCount.toInt, 3))
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments")
      segmentIds: MultiArray <- agglomerateToSegments.readAsMultiArray(offset = Array(positionsRange.getInt(0)),
                                                                       shape = Array(nodeCount.toInt))
      agglomerateToEdges <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_edges")
      edges: MultiArray <- agglomerateToEdges.readAsMultiArray(offset = Array(edgesRange.getLong(0), 0),
                                                               shape = Array(edgeCount.toInt, 2))
      agglomerateToAffinities <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_affinities")
      affinities: MultiArray <- agglomerateToAffinities.readAsMultiArray(offset = Array(edgesRange.getLong(0)),
                                                                         shape = Array(edgeCount.toInt))

      agglomerateGraph = AgglomerateGraph(
        // unsafeWrapArray is fine, because the underlying arrays are never mutated
        segments = ArraySeq.unsafeWrapArray(segmentIds.getStorage.asInstanceOf[Array[Long]]),
        edges = (0 until edges.getShape()(0)).map { edgeIdx: Int =>
          AgglomerateEdge(
            source = segmentIds.getLong(edges.getInt(edges.getIndex.set(Array(edgeIdx, 0)))),
            target = segmentIds.getLong(edges.getInt(edges.getIndex.set(Array(edgeIdx, 1))))
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
    } yield agglomerateGraph

  def segmentIdsForAgglomerateId(agglomerateFileKey: AgglomerateFileKey,
                                 agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    for {
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments_offsets")
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments")
      segmentRange <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = Array(agglomerateId), shape = Array(2))
      segmentCount = segmentRange.getLong(1) - segmentRange.getLong(0)
      segmentIds <- if (segmentCount == 0)
        Fox.successful(MultiArray.factory(DataType.LONG, Array(0, 0)))
      else
        agglomerateToSegments.readAsMultiArray(offset = Array(segmentRange.getLong(0)),
                                               shape = Array(segmentCount.toInt))
    } yield segmentIds.getStorage.asInstanceOf[Array[Long]].toSeq

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileKey, "segment_to_agglomerate")
      agglomerateIds <- Fox.serialCombined(segmentIds) { segmentId =>
        mapSingleSegment(segmentToAgglomerate, segmentId)
      }
    } yield agglomerateIds

  def positionForSegmentId(agglomerateFileKey: AgglomerateFileKey, segmentId: Long)(implicit ec: ExecutionContext,
                                                                                    tc: TokenContext): Fox[Vec3Int] =
    for {
      segmentToAgglomerate <- openZarrArrayCached(agglomerateFileKey, "segment_to_agglomerate")
      agglomerateId <- mapSingleSegment(segmentToAgglomerate, segmentId)
      agglomerateToSegmentsOffsets <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments_offsets")
      segmentsRange: MultiArray <- agglomerateToSegmentsOffsets.readAsMultiArray(offset = Array(agglomerateId),
                                                                                 shape = Array(2))
      agglomerateToSegments <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_segments")
      segmentIndex <- binarySearchForSegment(segmentsRange.getLong(0),
                                             segmentsRange.getLong(1),
                                             segmentId,
                                             agglomerateToSegments)
      agglomerateToPositions <- openZarrArrayCached(agglomerateFileKey, "agglomerate_to_positions")
      position <- agglomerateToPositions.readAsMultiArray(offset = Array(segmentIndex, 0), shape = Array(3, 1))
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
        segmentIdAtMiddleMA <- agglomerateToSegments.readAsMultiArray(offset = Array(middle), shape = Array(1))
        segmentIdAtMiddle = segmentIdAtMiddleMA.getLong(0)
        segmentIndex <- if (segmentIdAtMiddle == segmentId)
          Fox.successful(middle)
        else if (segmentIdAtMiddle < segmentId) {
          binarySearchForSegment(middle + 1L, rangeEnd, segmentId, agglomerateToSegments)
        } else binarySearchForSegment(rangeStart, middle - 1L, segmentId, agglomerateToSegments)
      } yield segmentIndex
    }
}

class Hdf5AgglomerateService @Inject()(config: DataStoreConfig) extends DataConverter with LazyLogging {
  // TODO
}

class AgglomerateService @Inject()(config: DataStoreConfig, zarrAgglomerateService: ZarrAgglomerateService)
    extends DataConverter
    with LazyLogging
    with FoxImplicits {
  private val agglomerateDir = "agglomerates"
  private val agglomerateFileExtension = "hdf5"
  private val datasetName = "/segment_to_agglomerate"
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val cumsumFileName = "cumsum.json"

  // TODO remove
  private val useZarr = true

  lazy val agglomerateFileCache = new AgglomerateFileCache(config.Datastore.Cache.AgglomerateFile.maxFileHandleEntries)

  def exploreAgglomerates(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Set[String] = {
    val layerDir = dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName).resolve(dataLayerName)
    PathUtils
      .listFiles(layerDir.resolve(agglomerateDir),
                 silent = true,
                 PathUtils.fileExtensionFilter(agglomerateFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil) // TODO explore zarr agglomerates?
      .toSet ++ Set(
      "agglomerate_view_5",
      "agglomerate_view_10",
      "agglomerate_view_15",
      "agglomerate_view_20",
      "agglomerate_view_25",
      "agglomerate_view_30",
      "agglomerate_view_35",
      "agglomerate_view_40",
      "agglomerate_view_45",
      "agglomerate_view_50",
      "agglomerate_view_55",
      "agglomerate_view_60",
      "agglomerate_view_65",
      "agglomerate_view_70",
      "agglomerate_view_75",
      "agglomerate_view_80",
      "agglomerate_view_85",
      "agglomerate_view_90",
      "agglomerate_view_95",
      "agglomerate_view_100"
    )
  }

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte])(implicit ec: ExecutionContext,
                                                                           tc: TokenContext): Fox[Array[Byte]] =
    if (useZarr) {
      zarrAgglomerateService.applyAgglomerate(request)(data)
    } else applyAgglomerateHdf5(request)(data).toFox

  private def applyAgglomerateHdf5(request: DataServiceDataRequest)(data: Array[Byte]): Box[Array[Byte]] = tryo {

    val agglomerateFileKey = AgglomerateFileKey.fromDataRequest(request)

    def convertToAgglomerate(input: Array[Long],
                             bytesPerElement: Int,
                             bufferFunc: (ByteBuffer, Long) => ByteBuffer): Array[Byte] = {

      val cachedAgglomerateFile = agglomerateFileCache.withCache(agglomerateFileKey)(initHDFReader)

      val agglomerateIds = cachedAgglomerateFile.cache match {
        case Left(agglomerateIdCache) =>
          input.map(el =>
            agglomerateIdCache.withCache(el, cachedAgglomerateFile.reader, cachedAgglomerateFile.dataset)(readHDF))
        case Right(boundingBoxCache) =>
          boundingBoxCache.withCache(request, input, cachedAgglomerateFile.reader)(readHDF)
      }
      cachedAgglomerateFile.finishAccess()

      agglomerateIds
        .foldLeft(ByteBuffer.allocate(bytesPerElement * input.length).order(ByteOrder.LITTLE_ENDIAN))(bufferFunc)
        .array
    }

    val bytesPerElement = ElementClass.bytesPerElement(request.dataLayer.elementClass)
    /* Every value of the segmentation data needs to be converted to Long to then look up the
       agglomerate id in the segment-to-agglomerate array.
       The value is first converted to the primitive signed number types, and then converted
       to Long via uByteToLong, uShortToLong etc, which perform bitwise and to take care of
       the unsigned semantics. Using functions avoids allocating intermediate SegmentInteger objects.
       Allocating a fixed-length LongBuffer first is a further performance optimization.
     */
    convertData(data, request.dataLayer.elementClass) match {
      case data: Array[Byte] =>
        val longBuffer = LongBuffer.allocate(data.length)
        data.foreach(e => longBuffer.put(uByteToLong(e)))
        convertToAgglomerate(longBuffer.array, bytesPerElement, putByte)
      case data: Array[Short] =>
        val longBuffer = LongBuffer.allocate(data.length)
        data.foreach(e => longBuffer.put(uShortToLong(e)))
        convertToAgglomerate(longBuffer.array, bytesPerElement, putShort)
      case data: Array[Int] =>
        val longBuffer = LongBuffer.allocate(data.length)
        data.foreach(e => longBuffer.put(uIntToLong(e)))
        convertToAgglomerate(longBuffer.array, bytesPerElement, putInt)
      case data: Array[Long] => convertToAgglomerate(data, bytesPerElement, putLong)
      case _                 => data
    }
  }

  // This uses a HDF5DataSet, which improves performance per call but doesn't permit parallel calls with the same dataset.
  private def readHDF(reader: IHDF5Reader, hdf5Dataset: HDF5DataSet, segmentId: Long, blockSize: Long): Array[Long] =
    // We don't need to differentiate between the data types because the underlying library does the conversion for us
    reader.uint64().readArrayBlockWithOffset(hdf5Dataset, blockSize.toInt, segmentId)

  // This uses the datasetName, which allows us to call it on the same hdf file in parallel.
  private def readHDF(reader: IHDF5Reader, segmentId: Long, blockSize: Long) =
    reader.uint64().readArrayBlockWithOffset(datasetName, blockSize.toInt, segmentId)

  // An agglomerate file holds information about a specific mapping. wK translates the segment ids to agglomerate ids by looking at the HDF5 dataset "/segment_to_agglomerate".
  // In this array, the agglomerate id is found by using the segment id as index.
  // There are two ways of how we prevent a file lookup for every input element. When present, we use the cumsum.json to initialize a BoundingBoxCache (see comment there).
  // Otherwise, we read configurable sized blocks from the agglomerate file and save them in a LRU cache.
  private def initHDFReader(agglomerateFileKey: AgglomerateFileKey) = {
    val hdfFile =
      agglomerateFileKey.path(dataBaseDir, agglomerateDir, agglomerateFileExtension).toFile

    val cumsumPath =
      dataBaseDir
        .resolve(agglomerateFileKey.organizationId)
        .resolve(agglomerateFileKey.datasetDirectoryName)
        .resolve(agglomerateFileKey.layerName)
        .resolve(agglomerateDir)
        .resolve(cumsumFileName)

    val reader = HDF5FactoryProvider.get.openForReading(hdfFile)

    val agglomerateIdCache = new AgglomerateIdCache(config.Datastore.Cache.AgglomerateFile.maxSegmentIdEntries,
                                                    config.Datastore.Cache.AgglomerateFile.blockSize)

    val defaultCache: Either[AgglomerateIdCache, BoundingBoxCache] =
      if (Files.exists(cumsumPath)) {
        Right(CumsumParser.parse(cumsumPath.toFile, config.Datastore.Cache.AgglomerateFile.cumsumMaxReaderRange))
      } else {
        Left(agglomerateIdCache)
      }

    CachedAgglomerateFile(reader, reader.`object`().openDataSet(datasetName), agglomerateIdCache, defaultCache)
  }

  def generateSkeleton(organizationId: String,
                       datasetDirectoryName: String,
                       dataLayerName: String,
                       mappingName: String,
                       agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[SkeletonTracing] =
    if (useZarr) {
      zarrAgglomerateService.generateSkeleton(organizationId,
                                              datasetDirectoryName,
                                              dataLayerName,
                                              mappingName,
                                              agglomerateId)
    } else {
      (try {
        val before = Instant.now
        val hdfFile =
          dataBaseDir
            .resolve(organizationId)
            .resolve(datasetDirectoryName)
            .resolve(dataLayerName)
            .resolve(agglomerateDir)
            .resolve(s"$mappingName.$agglomerateFileExtension")
            .toFile

        val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
        val positionsRange: Array[Long] =
          reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments_offsets", 2, agglomerateId)
        val edgesRange: Array[Long] =
          reader.uint64().readArrayBlockWithOffset("/agglomerate_to_edges_offsets", 2, agglomerateId)

        val nodeCount = positionsRange(1) - positionsRange(0)
        val edgeCount = edgesRange(1) - edgesRange(0)
        val edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
        if (nodeCount > edgeLimit) {
          throw new Exception(s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)")
        }
        if (edgeCount > edgeLimit) {
          throw new Exception(s"Agglomerate has too many edges ($edgeCount > $edgeLimit)")
        }
        val positions: Array[Array[Long]] =
          if (nodeCount == 0L) {
            Array.empty[Array[Long]]
          } else {
            reader
              .uint64()
              .readMatrixBlockWithOffset("/agglomerate_to_positions", nodeCount.toInt, 3, positionsRange(0), 0)
          }
        val edges: Array[Array[Long]] = {
          if (edgeCount == 0L) {
            Array.empty[Array[Long]]
          } else {
            reader.uint64().readMatrixBlockWithOffset("/agglomerate_to_edges", edgeCount.toInt, 2, edgesRange(0), 0)
          }
        }

        val nodeIdStartAtOneOffset = 1

        val nodes = positions.zipWithIndex.map {
          case (pos, idx) =>
            NodeDefaults.createInstance.copy(
              id = idx + nodeIdStartAtOneOffset,
              position = Vec3IntProto(pos(0).toInt, pos(1).toInt, pos(2).toInt)
            )
        }

        val skeletonEdges = edges.map { e =>
          Edge(source = e(0).toInt + nodeIdStartAtOneOffset, target = e(1).toInt + nodeIdStartAtOneOffset)
        }

        val trees = Seq(
          Tree(
            treeId = math.abs(agglomerateId.toInt), // used only to deterministically select tree color
            createdTimestamp = System.currentTimeMillis(),
            // unsafeWrapArray is fine, because the underlying arrays are never mutated
            nodes = ArraySeq.unsafeWrapArray(nodes),
            edges = ArraySeq.unsafeWrapArray(skeletonEdges),
            name = s"agglomerate $agglomerateId ($mappingName)",
            `type` = Some(TreeTypeProto.AGGLOMERATE)
          ))

        val skeleton = SkeletonTracingDefaults.createInstance.copy(
          datasetName = datasetDirectoryName,
          trees = trees
        )

        if (Instant.since(before) > (100 milliseconds)) {
          Instant.logSince(
            before,
            s"Generating skeleton from agglomerate file with ${skeletonEdges.length} edges, ${nodes.length} nodes",
            logger)
        }

        Full(skeleton)
      } catch {
        case e: Exception => Failure(e.getMessage)
      }).toFox
    }

  def largestAgglomerateId(agglomerateFileKey: AgglomerateFileKey)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[Long] =
    if (useZarr) zarrAgglomerateService.largestAgglomerateId(agglomerateFileKey)
    else {
      val hdfFile = agglomerateFileKey.path(dataBaseDir, agglomerateDir, agglomerateFileExtension).toFile
      tryo {
        val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
        reader.`object`().getNumberOfElements("/agglomerate_to_segments_offsets") - 1L
      }.toFox
    }

  def segmentIdsForAgglomerateId(agglomerateFileKey: AgglomerateFileKey,
                                 agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    if (useZarr)
      zarrAgglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
    else {
      val hdfFile =
        dataBaseDir
          .resolve(agglomerateFileKey.organizationId)
          .resolve(agglomerateFileKey.datasetDirectoryName)
          .resolve(agglomerateFileKey.layerName)
          .resolve(agglomerateDir)
          .resolve(s"${agglomerateFileKey.mappingName}.$agglomerateFileExtension")
          .toFile

      tryo {
        val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
        val positionsRange: Array[Long] =
          reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments_offsets", 2, agglomerateId)

        val segmentCount = positionsRange(1) - positionsRange(0)
        val segmentIds: Array[Long] =
          if (segmentCount == 0) Array.empty[Long]
          else {
            reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments", segmentCount.toInt, positionsRange(0))
          }
        segmentIds.toSeq
      }.toFox
    }

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    if (useZarr) {
      zarrAgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileKey, segmentIds)
    } else {
      val cachedAgglomerateFile = agglomerateFileCache.withCache(agglomerateFileKey)(initHDFReader)
      tryo {
        val agglomerateIds = segmentIds.map { segmentId: Long =>
          cachedAgglomerateFile.agglomerateIdCache.withCache(segmentId,
                                                             cachedAgglomerateFile.reader,
                                                             cachedAgglomerateFile.dataset)(readHDF)
        }
        cachedAgglomerateFile.finishAccess()
        agglomerateIds
      }.toFox
    }

  def positionForSegmentId(agglomerateFileKey: AgglomerateFileKey, segmentId: Long)(implicit ec: ExecutionContext,
                                                                                    tc: TokenContext): Fox[Vec3Int] =
    if (useZarr) zarrAgglomerateService.positionForSegmentId(agglomerateFileKey, segmentId)
    else {
      val hdfFile = agglomerateFileKey.path(dataBaseDir, agglomerateDir, agglomerateFileExtension).toFile
      val reader: IHDF5Reader = HDF5FactoryProvider.get.openForReading(hdfFile)
      (for {
        agglomerateIdArr: Array[Long] <- tryo(
          reader.uint64().readArrayBlockWithOffset("/segment_to_agglomerate", 1, segmentId))
        agglomerateId = agglomerateIdArr(0)
        segmentsRange: Array[Long] <- tryo(
          reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments_offsets", 2, agglomerateId))
        segmentIndex <- binarySearchForSegment(segmentsRange(0), segmentsRange(1), segmentId, reader)
        position <- tryo(
          reader.uint64().readMatrixBlockWithOffset("/agglomerate_to_positions", 1, 3, segmentIndex, 0)(0))
      } yield Vec3Int(position(0).toInt, position(1).toInt, position(2).toInt)).toFox
    }

  @tailrec
  private def binarySearchForSegment(rangeStart: Long,
                                     rangeEnd: Long,
                                     segmentId: Long,
                                     reader: IHDF5Reader): Box[Long] =
    if (rangeStart > rangeEnd) Failure("Could not find segmentId in agglomerate file")
    else {
      val middle = rangeStart + (rangeEnd - rangeStart) / 2
      val segmentIdAtMiddle: Long = reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments", 1, middle)(0)
      if (segmentIdAtMiddle == segmentId) Full(middle)
      else if (segmentIdAtMiddle < segmentId) binarySearchForSegment(middle + 1L, rangeEnd, segmentId, reader)
      else binarySearchForSegment(rangeStart, middle - 1L, segmentId, reader)
    }

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AgglomerateGraph] =
    if (useZarr)
      zarrAgglomerateService.generateAgglomerateGraph(agglomerateFileKey, agglomerateId)
    else {
      tryo {
        val hdfFile = agglomerateFileKey.path(dataBaseDir, agglomerateDir, agglomerateFileExtension).toFile

        val reader = HDF5FactoryProvider.get.openForReading(hdfFile)

        val positionsRange: Array[Long] =
          reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments_offsets", 2, agglomerateId)
        val edgesRange: Array[Long] =
          reader.uint64().readArrayBlockWithOffset("/agglomerate_to_edges_offsets", 2, agglomerateId)

        val nodeCount = positionsRange(1) - positionsRange(0)
        val edgeCount = edgesRange(1) - edgesRange(0)
        val edgeLimit = config.Datastore.AgglomerateSkeleton.maxEdges
        if (nodeCount > edgeLimit) {
          throw new Exception(s"Agglomerate has too many nodes ($nodeCount > $edgeLimit)")
        }
        if (edgeCount > edgeLimit) {
          throw new Exception(s"Agglomerate has too many edges ($edgeCount > $edgeLimit)")
        }
        val segmentIds: Array[Long] =
          if (nodeCount == 0L) Array[Long]()
          else
            reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments", nodeCount.toInt, positionsRange(0))
        val positions: Array[Array[Long]] =
          if (nodeCount == 0L) Array[Array[Long]]()
          else
            reader
              .uint64()
              .readMatrixBlockWithOffset("/agglomerate_to_positions", nodeCount.toInt, 3, positionsRange(0), 0)
        val edges: Array[Array[Long]] =
          if (edgeCount == 0L) Array[Array[Long]]()
          else
            reader.uint64().readMatrixBlockWithOffset("/agglomerate_to_edges", edgeCount.toInt, 2, edgesRange(0), 0)
        val affinities: Array[Float] =
          if (edgeCount == 0L) Array[Float]()
          else
            reader.float32().readArrayBlockWithOffset("/agglomerate_to_affinities", edgeCount.toInt, edgesRange(0))

        AgglomerateGraph(
          // unsafeWrapArray is fine, because the underlying arrays are never mutated
          segments = ArraySeq.unsafeWrapArray(segmentIds),
          edges = ArraySeq.unsafeWrapArray(
            edges.map(e => AgglomerateEdge(source = segmentIds(e(0).toInt), target = segmentIds(e(1).toInt)))),
          positions =
            ArraySeq.unsafeWrapArray(positions.map(pos => Vec3IntProto(pos(0).toInt, pos(1).toInt, pos(2).toInt))),
          affinities = ArraySeq.unsafeWrapArray(affinities)
        )
      }.toFox
    }

}
