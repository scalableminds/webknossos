package com.scalableminds.webknossos.datastore.services

import ch.systemsx.cisd.hdf5._
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.AgglomerateGraph.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, SkeletonTracing, Tree, TreeTypeProto}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.common.Box.tryo
import org.apache.commons.io.FilenameUtils

import java.nio._
import java.nio.file.{Files, Paths}
import javax.inject.Inject
import scala.annotation.tailrec
import scala.collection.compat.immutable.ArraySeq
import scala.concurrent.duration.DurationInt

class ZarrAgglomerateService @Inject()(config: DataStoreConfig) extends DataConverter with LazyLogging {
  def applyAgglomerateHdf5(request: DataServiceDataRequest)(data: Array[Byte]): Box[Array[Byte]] = tryo(data)

}

class Hdf5AgglomerateService @Inject()(config: DataStoreConfig) extends DataConverter with LazyLogging {
  // TODO
}

class AgglomerateService @Inject()(config: DataStoreConfig, zarrAgglomerateService: ZarrAgglomerateService)
    extends DataConverter
    with LazyLogging {
  private val agglomerateDir = "agglomerates"
  private val agglomerateFileExtension = "hdf5"
  private val datasetName = "/segment_to_agglomerate"
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val cumsumFileName = "cumsum.json"

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
      .getOrElse(Nil)
      .toSet
  }

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte]): Box[Array[Byte]] =
    if (true) {
      zarrAgglomerateService.applyAgglomerateHdf5(request)(data)
    } else applyAgglomerateHdf5(request)(data)

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

  // This uses the datasetDirectoryName, which allows us to call it on the same hdf file in parallel.
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
                       agglomerateId: Long): Box[SkeletonTracing] =
    try {
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
    }

  def largestAgglomerateId(agglomerateFileKey: AgglomerateFileKey): Box[Long] = {
    val hdfFile = agglomerateFileKey.path(dataBaseDir, agglomerateDir, agglomerateFileExtension).toFile

    tryo {
      val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
      reader.`object`().getNumberOfElements("/agglomerate_to_segments_offsets") - 1L
    }
  }

  def segmentIdsForAgglomerateId(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long): Box[List[Long]] = {
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
      segmentIds.toList
    }
  }

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long]): Box[Seq[Long]] = {
    val cachedAgglomerateFile = agglomerateFileCache.withCache(agglomerateFileKey)(initHDFReader)

    tryo {
      val agglomerateIds = segmentIds.map { segmentId: Long =>
        cachedAgglomerateFile.agglomerateIdCache.withCache(segmentId,
                                                           cachedAgglomerateFile.reader,
                                                           cachedAgglomerateFile.dataset)(readHDF)
      }
      cachedAgglomerateFile.finishAccess()
      agglomerateIds
    }

  }

  def agglomerateIdsForAllSegmentIds(agglomerateFileKey: AgglomerateFileKey): Box[Array[Long]] = {
    val file = agglomerateFileKey.path(dataBaseDir, agglomerateDir, agglomerateFileExtension).toFile
    tryo {
      val reader = HDF5FactoryProvider.get.openForReading(file)
      val agglomerateIds: Array[Long] = reader.uint64().readArray("/segment_to_agglomerate")
      agglomerateIds
    }
  }

  def positionForSegmentId(agglomerateFileKey: AgglomerateFileKey, segmentId: Long): Box[Vec3Int] = {
    val hdfFile = agglomerateFileKey.path(dataBaseDir, agglomerateDir, agglomerateFileExtension).toFile
    val reader: IHDF5Reader = HDF5FactoryProvider.get.openForReading(hdfFile)
    for {
      agglomerateIdArr: Array[Long] <- tryo(
        reader.uint64().readArrayBlockWithOffset("/segment_to_agglomerate", 1, segmentId))
      agglomerateId = agglomerateIdArr(0)
      segmentsRange: Array[Long] <- tryo(
        reader.uint64().readArrayBlockWithOffset("/agglomerate_to_segments_offsets", 2, agglomerateId))
      segmentIndex <- binarySearchForSegment(segmentsRange(0), segmentsRange(1), segmentId, reader)
      position <- tryo(reader.uint64().readMatrixBlockWithOffset("/agglomerate_to_positions", 1, 3, segmentIndex, 0)(0))
    } yield Vec3Int(position(0).toInt, position(1).toInt, position(2).toInt)
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

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long): Box[AgglomerateGraph] =
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
    }

}
