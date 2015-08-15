/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import java.awt.image.{BufferedImage, DataBufferByte}
import java.io._
import java.nio.file.{Files, Path}
import javax.imageio.ImageIO
import javax.imageio.spi.IIORegistry

import com.scalableminds.braingames.binary.Logger._
import com.scalableminds.braingames.binary.models.{UnusableDataSource, _}
import com.scalableminds.braingames.binary.store.DataStore
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import com.twelvemonkeys.imageio.plugins.tiff.TIFFImageReaderSpi
import org.apache.commons.io.FileUtils
import play.api.libs.concurrent.Execution.Implicits._

import scala.collection.JavaConversions._
import scala.util.matching.Regex

object TiffDataSourceType extends DataSourceType with ImageDataSourceTypeHandler {
  val name = "tiff"

  val fileExtension = "tif"

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

}

object PngDataSourceType extends DataSourceType with ImageDataSourceTypeHandler {
  val name = "png"

  val fileExtension = "png"
}

object JpegDataSourceType extends DataSourceType with ImageDataSourceTypeHandler {
  val name = "jpeg"

  val fileExtension = "jpg"
}

case class ImageLayer(layer: Int, width: Int, height: Int, depth: Int, bytesPerPixel: Int, images: Iterator[RawImage])

case class RawImage(width: Int, height: Int, bytesPerPixel: Int, data: Array[Byte])

case class StackInfo(boundingBox: BoundingBox, bytesPerPixel: Int)

trait ImageDataSourceTypeHandler extends DataSourceTypeHandler {
  val Target = "target"

  val LayerRxs = Seq(
    "_c([0-9]+)" r,
    "_ch([0-9]+)" r
  )

  def fileExtension: String

  lazy val IndexRxs = s"_([0-9]+)\\.${fileExtension}" r

  val DefaultScale = Scale(200, 200, 200)

  val DefaultLayerType = DataLayer.COLOR

  val DefaultLayer = 1

  val Resolutions = List(1, 2, 4, 8, 16, 32, 64, 128)

  // Data points in each direction of a cube in the knossos cube structure
  val CubeSize = 128

  // must be a divisor of cubeSize
  val ContainerSize = 128

  def prepareTargetPath(target: Path): Unit = {
    FileUtils.deleteQuietly(target.toFile)
    Files.createDirectories(target)
  }

  protected def elementClass(bytesPerPixel: Int) =
    s"uint${bytesPerPixel * 8}"

  def importDataSource(unusableDataSource: UnusableDataSource, progress: ProgressTracker): Option[DataSource] = {
    val target = (unusableDataSource.sourceFolder.resolve(Target)).toAbsolutePath

    prepareTargetPath(target)

    val layers = convertToKnossosStructure(unusableDataSource.id, unusableDataSource.sourceFolder, target, progress).toList

    DataSourceSettings.fromSettingsFileIn(unusableDataSource.sourceFolder) match {
      case Some(settings) =>
        Some(DataSource(
          unusableDataSource.id,
          target.toString,
          settings.scale,
          settings.priority getOrElse 0,
          dataLayers = layers))
      case _ =>
        Some(DataSource(
          unusableDataSource.id,
          target.toString,
          DefaultScale,
          dataLayers = layers))
    }
  }

  protected def extractImageInfo(images: List[Path]): Option[RawImage] = {
    images match {
      case head :: tail =>
        toRawImage(head) match {
          case Some(raw) => Some(raw)
          case _ => extractImageInfo(tail)
        }
      case _ =>
        None
    }
  }

  def layerFromFileName(file: Path) = {
    def extractLayer(rs: Seq[Regex]): Int = {
      rs match {
        case r :: tail =>
          r.findFirstMatchIn(file.toString).map(_.group(1).toInt) getOrElse extractLayer(tail)
        case _ =>
          DefaultLayer
      }
    }

    extractLayer(LayerRxs)
  }

  def extractLayers(files: List[Path]): Iterable[ImageLayer] = {

    def compareImageFiles(pathA: Path, pathB: Path) = {
      (for {
        indexA <- IndexRxs.findFirstMatchIn(pathA.toString).map(_.group(1).toInt)
        indexB <- IndexRxs.findFirstMatchIn(pathB.toString).map(_.group(1).toInt)
      } yield {
          indexA < indexB
        }) getOrElse (pathA.toString < pathB.toString)
    }

    files.groupBy(path => layerFromFileName(path)).flatMap {
      case (layer, layerImages) =>
        val depth = layerImages.size
        extractImageInfo(layerImages.toList) match {
          case Some(imageInfo) =>
            val rawImages = layerImages.toList.sortWith(compareImageFiles).toIterator.flatMap(t => toRawImage(t))
            Some(ImageLayer(layer, imageInfo.width, imageInfo.height, depth, imageInfo.bytesPerPixel, rawImages))
          case _ =>
            logger.warn("No image files found")
            None
        }
    }
  }

  def namingSchemaFor(layers: Iterable[ImageLayer])(idx: Int) = {
    if (layers.size == 1)
      "color"
    else
      s"color_$idx"
  }

  def convertToKnossosStructure(id: String, source: Path, targetRoot: Path, progress: ProgressTracker): Iterable[DataLayer] = {
    val images = PathUtils.listFiles(source).filter(_.getFileName.toString.endsWith("." + fileExtension))

    val layers = extractLayers(images.toList)
    val namingSchema = namingSchemaFor(layers) _

    val progressMax = images.size
    val progressPerLayer = progressMax.toFloat / layers.size

    layers.zipWithIndex.map {
      case (layer, idx) =>
        def progressReporter(i: Int) =
        // somewhat hacky way to meassure the progress
          progress.track(math.min((idx * progressPerLayer + i) / progressMax, 1))

        val layerName = namingSchema(layer.layer)
        val target = targetRoot.resolve(layerName)
        TileToCubeWriter(id, 1, target, layer.depth, layer.bytesPerPixel, layer.images, progressReporter _).convertToCubes()
        val boundingBox = BoundingBox(Point3D(0, 0, 0), layer.width, layer.height, layer.depth)
        KnossosMultiResCreator.createResolutions(target, target, id, layer.bytesPerPixel, 1, Resolutions.size, boundingBox).onFailure {
          case e: Exception =>
            logger.error(s"An error occourd while trying to down scale target of image stack $id. ${e.getMessage}", e)
        }

        val section = DataLayerSection(layerName, layerName, Resolutions, boundingBox, boundingBox)
        val elements = elementClass(layer.bytesPerPixel)

        DataLayer(layerName, DefaultLayerType.category, targetRoot.toString, None, elements, false, None, List(section))
    }
  }

  private def convertIfNecessary(image: BufferedImage) = {
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

  def toRawImage(imageFile: Path): Option[RawImage] = {
    PathUtils.fileOption(imageFile).map {
      file =>
        val image = convertIfNecessary(ImageIO.read(file))
        if (image == null) {
          logger.error("Couldn't load image file. " + ImageIO.getImageReaders(file).toList.map(_.getClass.toString))
          throw new Exception("Couldn't load image file due to missing reader.")
        } else {
          val raster = image.getRaster
          val data = (raster.getDataBuffer().asInstanceOf[DataBufferByte]).getData()
          val bytesPerPixel = imageTypeToByteDepth(image.getType)
          RawImage(image.getWidth, image.getHeight, bytesPerPixel, data)
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
        logger.error("Unsupported image byte format. Format number: " + x)
        throw new Exception("Unsupported image byte format. Format number: " + x)
    }
  }

  private class KnossosWriterCache(id: String, resolution: Int, folder: Path) {
    var cache = Map.empty[Point3D, FileOutputStream]

    def get(block: Point3D): FileOutputStream = {
      fileForPosition(block)
    }

    private def fileForPosition(block: Point3D): FileOutputStream = {
      val path = DataStore.knossosFilePath(folder, id, resolution, block)
      Files.createDirectories(path.getParent)
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

    case class FixedSizedImage(underlying: RawImage, targetWidth: Int, targetHeight: Int, zero: Byte = 0) {
      val uw = underlying.width
      val uh = underlying.height

      def copyTo(other: Array[Byte], destPos: Int, srcPos: Int, length: Int) = {
        var i = 0
        while (i < length) {
          val col = (i + srcPos) % targetWidth
          val row = (i + srcPos) / targetWidth
          var b = 0
          while (b < bytesPerPixel) {
            if (col >= uw || row >= uh)
              other((i * bytesPerPixel) + b + destPos * bytesPerPixel) = zero
            else {
              val data = underlying.data(row * uw * bytesPerPixel + col * bytesPerPixel + bytesPerPixel - b - 1)
              other((i * bytesPerPixel) + b + destPos * bytesPerPixel) = data
            }
            b += 1
          }
          i += 1
        }
      }
    }

    private def writeTile(tile: RawImage, sliceNumber: Int, files: KnossosWriterCache): Unit = {
      // number of knossos buckets in x direction
      val xs = (tile.data.length.toFloat / bytesPerPixel / tile.height / CubeSize).ceil.toInt
      // number of knossos buckets in y direction
      val ys = (tile.data.length.toFloat / bytesPerPixel / tile.width / CubeSize).ceil.toInt

      // the given array might not fill up the buckets at the border, but we need to make sure it does, otherwise
      // writing the data to the file would result in a bucket size less than 128
      val filledTile = FixedSizedImage(tile, xs * CubeSize, ys * CubeSize, zero = 0)

      val sliced: Array[Array[Byte]] = Array.fill(ys * xs)(Array.fill(CubeSize * CubeSize * bytesPerPixel)(0.toByte)) // (Vector.empty[Array[Byte]])

      (0 until (xs * ys * CubeSize)).foreach{ i =>
        val x = i % xs
        val y = i / xs / CubeSize
        filledTile.copyTo(sliced(y * xs + x), destPos = (i / xs) % CubeSize * CubeSize, srcPos = i * CubeSize, length = CubeSize)
      }

      sliced.zipWithIndex.map {
        case (cubeData, idx) =>
          val x = idx % xs
          val y = idx / xs
          val file = files.get(Point3D(x, y, sliceNumber / CubeSize))
          file.write(cubeData)
          file.close()
      }
    }
  }

}