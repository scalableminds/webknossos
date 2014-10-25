/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.nio.file.{Paths, Files, Path}

import com.scalableminds.braingames.binary.models._
import javax.imageio.ImageIO
import com.scalableminds.util.geometry.{BoundingBox, Scale, Point3D}
import java.io._
import com.scalableminds.braingames.binary.store.{FileDataStore, DataStore}
import com.scalableminds.braingames.binary.Logger._
import java.awt.image.{BufferedImage, DataBufferByte, DataBufferInt}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import org.apache.commons.io.FileUtils
import scala.collection.JavaConversions._
import javax.imageio.spi.IIORegistry
import com.twelvemonkeys.imageio.plugins.tiff.TIFFImageReaderSpi
import scala.Some
import com.scalableminds.braingames.binary.models.UnusableDataSource
import net.liftweb.common.Full
import scala.concurrent.Future
import com.scalableminds.util.tools.BlockedArray3D
import play.api.libs.concurrent.Execution.Implicits._
import scala.util.matching.Regex

object TiffDataSourceType extends DataSourceType with TiffDataSourceTypeHandler {
  val name = "tiff"

  val fileExtension = "tif"
}

case class TiffLayer(layer: Int, width: Int, height: Int, depth: Int, bytesPerPixel: Int, tiffs: Iterator[RawImage])

case class RawImage(width: Int, height: Int, bytesPerPixel: Int, data: Array[Byte])

case class StackInfo(boundingBox: BoundingBox, bytesPerPixel: Int)

trait TiffDataSourceTypeHandler extends DataSourceTypeHandler {
  val Target = "target"

  val LayerRxs = Seq(
    "_c([0-9]+)"r,
    "_ch([0-9]+)"r
  )

  val DefaultScale = Scale(200, 200, 200)

  val DefaultLayerType = DataLayer.COLOR

  val DefaultLayer = 1

  val Resolutions = List(1, 2, 4, 8, 16, 32, 64, 128)

  // Data points in each direction of a cube in the knossos cube structure
  val CubeSize = 128

  // must be a divisor of cubeSize
  val ContainerSize = 128

  registerTiffProvider()

  protected def registerTiffProvider() = {
    // sometimes there are problems with ImageIO finding the TiffImageReader
    // this should make sure the ImageReader is registered and can be used
    logger.info("Registering tiff provider")
    ImageIO.scanForPlugins()
    val registry = IIORegistry.getDefaultInstance()
    registry.registerServiceProvider(new TIFFImageReaderSpi())
    logger.info("Finished registering tiff provider")
  }

  protected def prepareTargetPath(target: Path): Unit = {
    FileUtils.deleteQuietly(target.toFile)
    Files.createDirectories(target)
  }

  protected def elementClass(bytesPerPixel: Int) =
    s"uint${bytesPerPixel * 8}"

  def importDataSource(unusableDataSource: UnusableDataSource, progress: ProgressTracker): Option[DataSource] = {
    val target = (unusableDataSource.sourceFolder.resolve(Target)).toAbsolutePath

    prepareTargetPath(target)

    val layers = convertToKnossosStructure(unusableDataSource.id, unusableDataSource.sourceFolder, target, progress).toList

    Some(DataSource(
      unusableDataSource.id,
      target.toString,
      DefaultScale,
      dataLayers = layers))
  }

  protected def extractImageInfo(tiffs: List[Path]): Option[RawImage] = {
    tiffs match {
      case head :: tail =>
        tiffToRawImage(head) match {
          case Some(tia) => Some(tia)
          case _ => extractImageInfo(tail)
        }
      case _ =>
        None
    }
  }

  def layerFromFileName(tiffFile: Path) = {
    def extractLayer(rs: Seq[Regex]): Int = {
      rs match{
        case r :: tail =>
          r.findFirstMatchIn(tiffFile.toString).map(_.group(1).toInt) getOrElse extractLayer(tail)
        case _ =>
          DefaultLayer
      }
    }

    extractLayer(LayerRxs)
  }

  def extractLayers(tiffs: List[Path]): Iterable[TiffLayer] = {
    tiffs.groupBy(path => layerFromFileName(path)).flatMap{
      case (layer, layerTiffs) =>
        val depth = layerTiffs.size
        extractImageInfo(layerTiffs.toList) match {
          case Some(tiffInfo) =>
            val rawImages = layerTiffs.toList.sortBy(_.getFileName.toString).toIterator.flatMap( t => tiffToRawImage(t))
            Some(TiffLayer(layer, tiffInfo.width, tiffInfo.height, depth, tiffInfo.bytesPerPixel, rawImages))
          case _ =>
            logger.warn("No tiff files found")
            None
        }
    }
  }

  def namingSchemaFor(layers: Iterable[TiffLayer])(idx: Int) = {
    if(layers.size == 1)
      "color"
    else
      s"color_$idx"
  }

  def convertToKnossosStructure(id: String, source: Path, targetRoot: Path, progress: ProgressTracker): Iterable[DataLayer] = {
    val tiffs = PathUtils.listFiles(source).filter(_.getFileName.toString.endsWith(".tif"))

    val layers = extractLayers(tiffs.toList)
    val namingSchema = namingSchemaFor(layers) _

    val progressMax = tiffs.size
    val progressPerLayer = progressMax.toFloat / layers.size

    layers.zipWithIndex.map{
      case (layer, idx) =>
      def progressReporter(i: Int) =
        // somewhat hacky way to meassure the progress
        progress.track(math.min((idx * progressPerLayer + i) / progressMax, 1))


      val layerName = namingSchema(layer.layer)
      val target = targetRoot.resolve(layerName)
      TileToCubeWriter(id, 1, target, layer.depth, layer.bytesPerPixel, layer.tiffs, progressReporter _ ).convertToCubes()
      val boundingBox = BoundingBox(Point3D(0, 0, 0), layer.width, layer.height, layer.depth)
      KnossosMultiResCreator.createResolutions(target, target, id, layer.bytesPerPixel, 1, Resolutions.size, boundingBox).onFailure{
        case e: Exception =>
          logger.error(s"An error occourd while trying to down scale target of tiff stack $id. ${e.getMessage}", e)
      }

      val section = DataLayerSection(layerName, layerName, Resolutions, boundingBox, boundingBox)
      val elements = elementClass(layer.bytesPerPixel)

      DataLayer(layerName, DefaultLayerType.category, targetRoot.toString, None, elements, false, None, List(section))
    }
  }

  private class KnossosWriterCache(id: String, resolution: Int, folder: Path) {
    var cache = Map.empty[Point3D, FileOutputStream]

    def get(block: Point3D): FileOutputStream = {
      fileForPosition(block)
    }

    private def fileForPosition(block: Point3D): FileOutputStream = {
      val path = DataStore.knossosFilePath(folder, id, resolution, block)
      PathUtils.createFile(path, failIfExists = false)
      PathUtils.fileOption(path) match {
        case Some(f) =>
          new FileOutputStream(f, true)
        case None =>
          throw new Exception("Couldn't open file: " + path)
      }
    }

    def closeAll() = {
      cache.mapValues(_.close())
      cache = Map.empty
    }
  }

  case class TileToCubeWriter(id: String, resolutions: Int, target: Path, depth: Int, bytesPerPixel: Int, tiles: Iterator[RawImage], progressHook: Int => Unit) {
    val CubeSize = 128

    def convertToCubes(cubeSize: Int = 128) = {
      val fileCache = new KnossosWriterCache(id, 1, target)
      tiles.zipWithIndex.foreach {
        case (tile, idx) =>
          writeTile(tile, idx, fileCache)
          progressHook(idx)
      }
      fileCache.closeAll()
    }

    private def fillUpToKnossosSize(tile: RawImage, xs: Int, ys: Int, bytesPerPixel: Int) = {
      // how many bytes are missing in each x row
      val destWidth = xs * CubeSize * bytesPerPixel
      val fillUpSize = destWidth - tile.width * bytesPerPixel
      if (fillUpSize == 0)
        tile.data
      else {
        val size = destWidth * CubeSize * ys
        val result = new Array[Byte](size)
        val placeholder = Array.fill(fillUpSize)(0.toByte)
        tile.data.grouped(tile.width * bytesPerPixel).zipWithIndex.foreach {
          case (column, idx) =>
            column.copyToArray(result, idx * destWidth)
            placeholder.copyToArray(result, idx * destWidth + tile.width * bytesPerPixel)
        }
        result
      }
    }

    private def writeTile(tile: RawImage, layerNumber: Int, files: KnossosWriterCache): Unit = {
      // number of knossos buckets in x direction
      val xs = (tile.data.length.toFloat / bytesPerPixel / tile.height / CubeSize).ceil.toInt
      // number of knossos buckets in y direction
      val ys = (tile.data.length.toFloat / bytesPerPixel / tile.width / CubeSize).ceil.toInt

      // the given array might not fill up the buckets at the border, but we need to make sure it does, otherwise
      // writing the data to the file would result in a bucket size less than 128
      val filledTile = fillUpToKnossosSize(tile, xs, ys, bytesPerPixel)

      val sliced = Array.fill(ys * xs)(Vector.empty[Array[Byte]])

      filledTile.grouped(bytesPerPixel * CubeSize).zipWithIndex.foreach {
        case (slice, i) =>
          val x = i % xs
          val y = i / xs / CubeSize
          val idx = y * xs + x
          sliced(idx) = sliced(idx) :+ slice
      }

      sliced.zipWithIndex.map {
        case (cubeData, idx) =>
          val x = idx % xs
          val y = idx / xs
          val file = files.get(Point3D(x, y, layerNumber / CubeSize))
          cubeData.map(file.write)
          file.close()
      }
    }
  }

  def imageTypeToByteDepth(typ: Int) = {
    typ match {
      case BufferedImage.TYPE_BYTE_GRAY =>
        1
      case BufferedImage.TYPE_3BYTE_BGR =>
        3
      case x =>
        logger.error("Unsupported tiff byte format. Format number: " + x)
        throw new Exception("Unsupported tiff byte format. Format number: " + x)
    }
  }

  def convertIfNecessary(image: BufferedImage) = {
    def convertTo(targetType: Int) = {
      logger.debug(s"Converting image from type ${image.getType} to $targetType")
      val convertedImage = new BufferedImage(
        image.getWidth(),
        image.getHeight(),
        targetType)
      convertedImage.setData(image.getRaster)
      convertedImage
    }

    image.getType match {
      case BufferedImage.TYPE_BYTE_INDEXED =>
        convertTo(BufferedImage.TYPE_BYTE_GRAY)
      case _ =>
        image
    }
  }

  def tiffToRawImage(tiffFile: Path): Option[RawImage] = {
    PathUtils.fileOption(tiffFile).map {
      file =>
        val tiff = convertIfNecessary(ImageIO.read(file))
        if (tiff == null) {
          logger.error("Couldn't load tiff file. " + ImageIO.getImageReaders(file).toList.map(_.getClass.toString))
          throw new Exception("Couldn't load tiff file due to missing tif reader.")
        } else {
          val raster = tiff.getRaster
          val data = (raster.getDataBuffer().asInstanceOf[DataBufferByte]).getData()
          val bytesPerPixel = imageTypeToByteDepth(tiff.getType)
          RawImage(tiff.getWidth, tiff.getHeight, bytesPerPixel, data)
        }
    }
  }
}