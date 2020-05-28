package com.scalableminds.webknossos.datastore.services

import java.nio._
import java.nio.file.Paths

import ch.systemsx.cisd.hdf5._
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage.{AgglomerateCache, AgglomerateFileCache, CachedReader}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import org.apache.commons.io.FilenameUtils
import spire.math.{UByte, UInt, ULong, UShort}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.Try

class AgglomerateService @Inject()(config: DataStoreConfig) extends DataConverter with FoxImplicits with LazyLogging {
  val agglomerateDir = "agglomerates"
  val agglomerateFileExtension = "hdf5"
  val datasetName = "/segment_to_agglomerate"
  val dataBaseDir = Paths.get(config.Braingames.Binary.baseFolder)

  lazy val cachedFileHandles = new AgglomerateFileCache(config.Braingames.Binary.agglomerateFileCacheMaxSize)
  lazy val cache = new AgglomerateCache(config.Braingames.Binary.agglomerateCacheMaxSize)

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
    def segmentToAgglomerate(segmentId: ULong) =
      cache.withCache(request, segmentId, cachedFileHandles)(readFromFile = readHDF)(loadReader = initHDFReader)

    def byteFunc(buf: ByteBuffer, lon: Long) = buf put lon.toByte
    def shortFunc(buf: ByteBuffer, lon: Long) = buf putShort lon.toShort
    def intFunc(buf: ByteBuffer, lon: Long) = buf putInt lon.toInt
    def longFunc(buf: ByteBuffer, lon: Long) = buf putLong lon

    def convertToAgglomerate(input: Array[ULong],
                             numBytes: Int,
                             bufferFunc: (ByteBuffer, Long) => ByteBuffer): Array[Byte] = {
      val agglomerateIds = input.map(segmentToAgglomerate)
      agglomerateIds
        .foldLeft(ByteBuffer.allocate(numBytes * input.length).order(ByteOrder.LITTLE_ENDIAN))(bufferFunc)
        .array
    }

    convertData(data, request.dataLayer.elementClass) match {
      case data: Array[UByte]  => convertToAgglomerate(data.map(e => ULong(e.toLong)), 1, byteFunc)
      case data: Array[UShort] => convertToAgglomerate(data.map(e => ULong(e.toLong)), 2, shortFunc)
      case data: Array[UInt]   => convertToAgglomerate(data.map(e => ULong(e.toLong)), 4, intFunc)
      case data: Array[ULong]  => convertToAgglomerate(data, 8, longFunc)
      // we can safely map the ULong to Long because we only do operations that are compatible with the two's complement
      case _ => data
    }
  }

  private def readHDF(reader: IHDF5Reader, segmentId: Long, blockSize: Long): Array[Long] =
    // We don't need to differentiate between the datatypes because the underlying library does the conversion for us
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
    val reader = HDF5FactoryProvider.get.openForReading(hdfFile)
    CachedReader(reader, ULong(reader.getDataSetInformation(datasetName).getNumberOfElements))
  }
}
