package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths
import java.nio._

import ch.systemsx.cisd.hdf5._
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage.{AgglomerateCache, AgglomerateFileCache, CachedReader}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import org.apache.commons.io.FilenameUtils
import spire.math.{UByte, UInt, ULong, UShort}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.reflect.ClassTag
import scala.util.Try

class AgglomerateService @Inject()(config: DataStoreConfig) extends DataConverter with FoxImplicits with LazyLogging {
  val agglomerateDir = "agglomerates"
  val agglomerateFileExtension = "hdf5"
  val datasetName = "/segment_to_agglomerate"
  val dataBaseDir = Paths.get(config.Braingames.Binary.baseFolder)

  lazy val cachedFileHandles = new AgglomerateFileCache(config.Braingames.Binary.mappingCacheMaxSize)
  lazy val cache = new AgglomerateCache(config.Braingames.Binary.cacheMaxSize)

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

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte]): Fox[Array[Byte]] = {
    def segmentToAgglomerate(segmentId: Long) =
      cache.withCache(request, segmentId, cachedFileHandles)(readFromFile = readHDFBlock)(loadReader = initHDFReader)

    def byteFunc(buf: ByteBuffer, lon: Long) = buf put lon.toByte
    def shortFunc(buf: ByteBuffer, lon: Long) = buf putShort lon.toShort
    def intFunc(buf: ByteBuffer, lon: Long) = buf putInt lon.toInt
    def longFunc(buf: ByteBuffer, lon: Long) = buf putLong lon

    def convertToAgglomerate(input: Array[Long],
                             numBytes: Int,
                             bufferFunc: (ByteBuffer, Long) => ByteBuffer): Fox[Array[Byte]] = {
      val agglomerateIds = Fox.combined(input.map(segmentToAgglomerate))
      agglomerateIds.map(
        _.foldLeft(ByteBuffer.allocate(numBytes * input.length).order(ByteOrder.LITTLE_ENDIAN))(bufferFunc).array)
    }

    convertData(data, request.dataLayer.elementClass) match {
      case data: Array[UByte]  => convertToAgglomerate(data.map(_.toLong), 1, byteFunc)
      case data: Array[UShort] => convertToAgglomerate(data.map(_.toLong), 2, shortFunc)
      case data: Array[UInt]   => convertToAgglomerate(data.map(_.toLong), 4, intFunc)
      case data: Array[ULong]  => convertToAgglomerate(data.map(_.toLong), 8, longFunc)
      // we can safely map the ULong to Long because we only do operations that are compatible with the two's complement
      case _ => Fox.successful(data)
    }
  }

  private def readHDFBlock(reader: IHDF5Reader, request: DataServiceDataRequest, segmentId: Long): Fox[Long] =
    request.dataLayer.elementClass match {
      case ElementClass.uint8 =>
        try2Fox(Try(reader.uint8().readArrayBlockWithOffset(datasetName, 1, segmentId).head.toLong))
      case ElementClass.uint16 =>
        try2Fox(Try(reader.uint16().readArrayBlockWithOffset(datasetName, 1, segmentId).head.toLong))
      case ElementClass.uint32 =>
        try2Fox(Try(reader.uint32().readArrayBlockWithOffset(datasetName, 1, segmentId).head.toLong))
      case ElementClass.uint64 =>
        try2Fox(Try(reader.uint64().readArrayBlockWithOffset(datasetName, 1, segmentId).head))
      case _ => Fox.failure("Unsupported data type")
    }

  private def initHDFReader(request: DataServiceDataRequest) = {
    val hdfFile = Try(
      dataBaseDir
        .resolve(request.dataSource.id.team)
        .resolve(request.dataSource.id.name)
        .resolve(request.dataLayer.name)
        .resolve(agglomerateDir)
        .resolve(s"${request.settings.appliedAgglomerate.get}.${agglomerateFileExtension}")
        .toFile)
    try2Fox(hdfFile.map(f => CachedReader(HDF5FactoryProvider.get.openForReading(f))))
  }
}
