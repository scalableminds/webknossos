package com.scalableminds.webknossos.datastore.services

import java.nio._
import java.nio.file.{Files, Paths}

import ch.systemsx.cisd.base.mdarray.MDLongArray
import ch.systemsx.cisd.hdf5._
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage.{AgglomerateFileCache, AgglomerateIdCache, BoundingBoxCache, CachedAgglomerateFile, CumsumParser}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import org.apache.commons.io.FilenameUtils
import spire.math.{UByte, UInt, ULong, UShort}

import scala.concurrent.ExecutionContext

class AgglomerateService @Inject()(config: DataStoreConfig) extends DataConverter with LazyLogging {
  val agglomerateDir = "agglomerates"
  val agglomerateFileExtension = "hdf5"
  val datasetName = "/segment_to_agglomerate"
  val dataBaseDir = Paths.get(config.Braingames.Binary.baseFolder)
  val cumsumFileName = "cumsum.json"

  lazy val agglomerateFileCache = new AgglomerateFileCache(config.Braingames.Binary.agglomerateFileCacheMaxSize)

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
    def byteFunc(buf: ByteBuffer, lon: Long) = buf put lon.toByte
    def shortFunc(buf: ByteBuffer, lon: Long) = buf putShort lon.toShort
    def intFunc(buf: ByteBuffer, lon: Long) = buf putInt lon.toInt
    def longFunc(buf: ByteBuffer, lon: Long) = buf putLong lon

    def convertToAgglomerate(input: Array[ULong],
                             numBytes: Int,
                             bufferFunc: (ByteBuffer, Long) => ByteBuffer): Array[Byte] = {
      val cachedAgglomerateFile = agglomerateFileCache.withCache(request)(initHDFReader)

      val agglomerateIds = cachedAgglomerateFile.cache match {
        case Left(agglomerateIdCache) =>
          input.map(
            el =>
              agglomerateIdCache.withCache(el,
                                           cachedAgglomerateFile.reader,
                                           cachedAgglomerateFile.dataset,
                                           cachedAgglomerateFile.size)(readHDF))
        case Right(boundingBoxCache) =>
          boundingBoxCache.withCache(request, input, cachedAgglomerateFile.reader)(readHDF)
      }
      cachedAgglomerateFile.finishAccess()

      agglomerateIds
        .foldLeft(ByteBuffer.allocate(numBytes * input.length).order(ByteOrder.LITTLE_ENDIAN))(bufferFunc)
        .array
    }

    convertData(data, request.dataLayer.elementClass) match {
      case data: Array[UByte]  => convertToAgglomerate(data.map(e => ULong(e.toLong)), 1, byteFunc)
      case data: Array[UShort] => convertToAgglomerate(data.map(e => ULong(e.toLong)), 2, shortFunc)
      case data: Array[UInt]   => convertToAgglomerate(data.map(e => ULong(e.toLong)), 4, intFunc)
      case data: Array[ULong]  => convertToAgglomerate(data, 8, longFunc)
      case _                   => data
    }
  }

  // This uses a HDF5DataSet, which improves performance per call but doesn't permit parallel calls with the same dataset.
  private def readHDF(reader: IHDF5Reader, dataSet: HDF5DataSet, segmentId: Long, blockSize: Long): Array[Long] =
    // We don't need to differentiate between the data types because the underlying library does the conversion for us
    reader.uint64().readArrayBlockWithOffset(dataSet, blockSize.toInt, segmentId)

  // This uses the datasetName, which allows us to call it on the same hdf file in parallel.
  private def readHDF(reader: IHDF5Reader, segmentId: Long, blockSize: Long) =
    reader.uint64().readArrayBlockWithOffset(datasetName, blockSize.toInt, segmentId)

  private def initHDFReader(request: DataServiceDataRequest) = {
    val hdfFile =
      dataBaseDir
        .resolve(request.dataSource.id.team)
        .resolve(request.dataSource.id.name)
        .resolve(request.dataLayer.name)
        .resolve(agglomerateDir)
        .resolve(s"${request.settings.appliedAgglomerate.get}.${agglomerateFileExtension}")
        .toFile

    val cumsumPath =
      dataBaseDir
        .resolve(request.dataSource.id.team)
        .resolve(request.dataSource.id.name)
        .resolve(request.dataLayer.name)
        .resolve(agglomerateDir)
        .resolve(cumsumFileName)

    val reader = HDF5FactoryProvider.get.openForReading(hdfFile)

    val cache: Either[AgglomerateIdCache, BoundingBoxCache] =
      if (Files.exists(cumsumPath)) {
        Right(CumsumParser.parse(cumsumPath.toFile, ULong(config.Braingames.Binary.agglomerateMaxReaderRange)))
      } else {
        Left(
          new AgglomerateIdCache(config.Braingames.Binary.agglomerateCacheMaxSize,
                                 config.Braingames.Binary.agglomerateStandardBlockSize))
      }

    CachedAgglomerateFile(reader,
                          reader.`object`().openDataSet(datasetName),
                          ULong(reader.getDataSetInformation(datasetName).getNumberOfElements),
                          cache)
  }



  def generateSkeleton(organizationName: String,
                       dataSetName: String,
                       dataLayerName: String,
                       mappingName: String,
                       agglomerateId: Long
                      )(implicit ec: ExecutionContext): Fox[String] = {

    val hdfFile =
      dataBaseDir
        .resolve(organizationName)
        .resolve(dataSetName)
        .resolve(dataLayerName)
        .resolve(agglomerateDir)
        .resolve(s"${mappingName}.${agglomerateFileExtension}")
        .toFile

    val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
    val agglomerate_to_segments_offsets = reader.`object`().openDataSet("/agglomerate_to_segments_offsets")
    val range: Array[Long] = reader.uint64().readArrayBlockWithOffset(agglomerate_to_segments_offsets, 2, agglomerateId)

    //val agglomerate_to_positions = reader.`object`().openDataSet("")
    //val positions: MDLongArray = reader.uint64().readMDArrayBlockWithOffset("/agglomerate_to_positions", List((range(1) - range(0)).toInt, 0).toArray, List(range(0), 0).toArray)
    //val positionsFormatted = positions.dimensions.mkString(",")

    Fox.successful(s"here comes the skeleton. segments offsets ${range(0)} to ${range(1)}")
  }
}
