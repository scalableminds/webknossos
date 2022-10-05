package com.scalableminds.webknossos.datastore.services

import ch.systemsx.cisd.hdf5._
import com.scalableminds.util.io.PathUtils
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.EditableMapping.{AgglomerateEdge, AgglomerateGraph}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, SkeletonTracing, Tree}
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.FilenameUtils

import java.nio._
import java.nio.file.{Files, Paths}
import javax.inject.Inject

class AgglomerateService @Inject()(config: DataStoreConfig) extends DataConverter with LazyLogging {
  private val agglomerateDir = "agglomerates"
  private val agglomerateFileExtension = "hdf5"
  private val datasetName = "/segment_to_agglomerate"
  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val cumsumFileName = "cumsum.json"

  lazy val agglomerateFileCache = new AgglomerateFileCache(config.Datastore.Cache.AgglomerateFile.maxFileHandleEntries)

  def exploreAgglomerates(organizationName: String, dataSetName: String, dataLayerName: String): Set[String] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName)
    PathUtils
      .listFiles(layerDir.resolve(agglomerateDir), PathUtils.fileExtensionFilter(agglomerateFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet
  }

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte]): Array[Byte] = {

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
  private def readHDF(reader: IHDF5Reader, dataSet: HDF5DataSet, segmentId: Long, blockSize: Long): Array[Long] =
    // We don't need to differentiate between the data types because the underlying library does the conversion for us
    reader.uint64().readArrayBlockWithOffset(dataSet, blockSize.toInt, segmentId)

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
        .resolve(agglomerateFileKey.organizationName)
        .resolve(agglomerateFileKey.dataSetName)
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

  def generateSkeleton(organizationName: String,
                       dataSetName: String,
                       dataLayerName: String,
                       mappingName: String,
                       agglomerateId: Long): Box[SkeletonTracing] =
    try {
      val startTime = System.nanoTime()
      val hdfFile =
        dataBaseDir
          .resolve(organizationName)
          .resolve(dataSetName)
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
          nodes = nodes,
          edges = skeletonEdges,
          name = s"agglomerate $agglomerateId ($mappingName)"
        ))

      val skeleton = SkeletonTracingDefaults.createInstance.copy(
        dataSetName = dataSetName,
        trees = trees,
        organizationName = Some(organizationName)
      )
      val duration = System.nanoTime() - startTime
      if (duration > 100 * 1e6) {
        logger.info(s"Generating skeleton from agglomerate file took ${math
          .round(duration / 1e6)} ms (${skeletonEdges.length} edges, ${nodes.length} nodes).")
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

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: List[Long]): Box[List[Long]] = {
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
        segments = segmentIds,
        edges = edges.map(e => AgglomerateEdge(source = segmentIds(e(0).toInt), target = segmentIds(e(1).toInt))),
        positions = positions.map(pos => Vec3IntProto(pos(0).toInt, pos(1).toInt, pos(2).toInt)),
        affinities = affinities
      )
    }

}
