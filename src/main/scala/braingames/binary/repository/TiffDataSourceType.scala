/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scalax.file.{PathMatcher, Path}
import braingames.binary.models.{DataLayerSection, DataLayer, UnusableDataSource, DataSource}
import javax.imageio.ImageIO
import braingames.geometry.{BoundingBox, Scale, Point3D}
import java.io._
import braingames.binary.store.DataStore
import braingames.binary.Logger._
import scala.Some
import braingames.binary.models.UnusableDataSource
import java.awt.image.{BufferedImage, DataBufferByte, DataBufferInt}
import braingames.util.ProgressTracking.ProgressTracker
import scala.collection.JavaConversions._
import javax.imageio.spi.IIORegistry
import com.twelvemonkeys.imageio.plugins.tiff.TIFFImageReaderSpi

object TiffDataSourceType extends DataSourceType with TiffDataSourceTypeHandler {
  val name = "tiff"

  def chanceOfInboxType(source: Path) = {
    (source ** "*.tif")
      .take(MaxNumberOfFilesForGuessing)
      .size.toFloat / MaxNumberOfFilesForGuessing
  }
}


trait TiffDataSourceTypeHandler extends DataSourceTypeHandler{
  val Target = "target"


  registerTiffProvider()

  def registerTiffProvider() = {
    logger.info("Registering tiff provider")
    ImageIO.scanForPlugins()
    val registry = IIORegistry.getDefaultInstance()
    registry.registerServiceProvider(new TIFFImageReaderSpi())
    logger.info("Finished registering tiff provider")
  }


  case class TiffImageArray(width: Int, height: Int, bytesPerPixel: Int, data: Array[Byte])

  case class TiffStackInfo(boundingBox: BoundingBox, bytesPerPixel: Int)

  def importDataSource(unusableDataSource: UnusableDataSource, progress: ProgressTracker): Option[DataSource] = {
    val layerType = DataLayer.COLOR
    val targetPath = unusableDataSource.sourceFolder / Target / layerType.name

    targetPath.deleteRecursively()
    targetPath.createDirectory()

    convertToKnossosStructure(unusableDataSource.id, unusableDataSource.sourceFolder, targetPath, progress).map{ stackInfo =>
      val section = DataLayerSection(layerType.name, layerType.name, List(1), stackInfo.boundingBox, stackInfo.boundingBox)
      val elementClass = s"uint${stackInfo.bytesPerPixel * 8}"
      val layer = DataLayer(layerType.name, None, elementClass, None, List(section))
      DataSource(
        unusableDataSource.id,
        (unusableDataSource.sourceFolder / Target).toAbsolute.path,
        Scale(200, 200, 200),
        dataLayers = List(layer))

    }

  }

  // Data points in each direction of a cube in the knossos cube structure
  val CubeSize = 128

  // must be a divisor of cubeSize
  val ContainerSize = 128

  def extractImageInfo(tiffs: List[Path]): Option[TiffImageArray] = {
    tiffs match{
      case head :: tail =>
        tiffToColorArray(head) match {
          case Some(tia) => Some(tia)
          case _ => extractImageInfo(tail)
        }
      case _ =>
        None
    }
  }

  def convertToKnossosStructure(id: String, source: Path, target: Path, progress: ProgressTracker): Option[TiffStackInfo] = {
    val tiffs = (source * "*.tif")
    val depth = tiffs.size
    extractImageInfo(tiffs.toList) match{
      case Some(tiffInfo) =>
        val tiles = tiffs.toList.sortBy(_.name).toIterator.zipWithIndex.flatMap{
          case (t, idx) =>
            progress.track((idx+1).toFloat / depth)
            tiffToColorArray(t).map(_.data)
        }
        TileToCubeWriter(id, 1, target, tiffInfo.width, tiffInfo.height, tiffInfo.bytesPerPixel, tiles ).convertToCubes()
        Some(TiffStackInfo(BoundingBox(Point3D(0,0,0), tiffInfo.width, tiffInfo.height, depth), tiffInfo.bytesPerPixel))
      case _ =>
        logger.warn("No tiff files found")
        None
    }
  }

  private class KnossosWriterCache(id: String, resolution: Int, folder: Path){
    var cache = Map.empty[(Int, Int, Int), FileOutputStream]

    def get(x: Int, y: Int, z: Int): FileOutputStream = {
      cache.get((x, y, z)).getOrElse{
        val f = fileForPosition(x,y,z)
        cache += (x,y,z) -> f
        f
      }
    }

    private def fileForPosition(x: Int, y: Int, z: Int): FileOutputStream = {
      val p = (folder / Path.fromString(DataStore.knossosFilePath(id, resolution, x, y, z)))
      p.createFile(failIfExists = false)
      p.fileOption match{
        case Some(f) =>
          new FileOutputStream(f, true)
        case None =>
          throw new Exception("Couldn't open file: " + p)
      }
    }

    def closeAll() = {
      cache.mapValues( _.close())
      cache = Map.empty
    }
  }

  case class TileToCubeWriter(id: String, resolution: Int, target: Path, width: Int, height: Int, bytesPerPixel: Int, tiles: Iterator[Array[Byte]]){
    val CubeSize = 128


    def convertToCubes(cubeSize: Int = 128) = {
      val fileCache = new KnossosWriterCache(id, resolution, target)
      tiles.zipWithIndex.foreach{
        case (tile, idx) =>
          writeTile(tile, idx, width, height, fileCache)
      }
      fileCache.closeAll()
    }

    private def fillUpToKnossosSize(tile: Array[Byte], xs: Int, ys: Int, width: Int, height: Int, bytesPerPixel: Int) = {
      // how many bytes are missing in each x row
      val destWidth = xs * CubeSize *  bytesPerPixel
      val fillUpSize = destWidth - width * bytesPerPixel
      if(fillUpSize == 0)
        tile
      else {
        val size = destWidth * CubeSize * ys
        val result = new Array[Byte](size)
        val placeholder = Array.fill(fillUpSize)(0.toByte)
        tile.grouped(width * bytesPerPixel).zipWithIndex.foreach{
          case (column, idx) =>
            column.copyToArray(result, idx * destWidth)
            placeholder.copyToArray(result, idx * destWidth + width * bytesPerPixel)
        }
        result
      }
    }

    private def writeTile(tile: Array[Byte], layerNumber: Int, width: Int, height: Int, files: KnossosWriterCache): Unit = {
      // number of knossos buckets in x direction
      val xs = (tile.length.toFloat / bytesPerPixel / height / CubeSize).ceil.toInt
      // number of knossos buckets in y direction
      val ys = (tile.length.toFloat / bytesPerPixel / width / CubeSize).ceil.toInt

      // the given array might not fill up the buckets at the border, but we need to make sure it does, otherwise
      // writing the data to the file would result in a bucket size less than 128
      val filledTile = fillUpToKnossosSize(tile, xs, ys, width, height, bytesPerPixel)

      val sliced = Array.fill(ys * xs)(Vector.empty[Array[Byte]])

      filledTile.grouped(bytesPerPixel * CubeSize).zipWithIndex.foreach{
        case (slice , i) =>
          val x = i % xs
          val y = i / xs / CubeSize
          val idx = y * xs + x
          sliced(idx) = sliced(idx) :+ slice
      }

      sliced.zipWithIndex.map{
        case (cubeData, idx) =>
          val x = idx % xs
          val y = idx / xs
          val file = files.get(x, y, layerNumber / CubeSize)
          cubeData.map(file.write)
      }
    }
  }

  def imageTypeToByteDepth(typ: Int) = {
    typ match{
      case BufferedImage.TYPE_BYTE_GRAY =>
        1
      case BufferedImage.TYPE_3BYTE_BGR =>
        3
      case _ =>
        logger.error("Unsupported tiff byte format.")
        throw new Exception("Unsupported tiff byte format")
    }
  }

  def tiffToColorArray(tiffFile: Path): Option[TiffImageArray] = {
    tiffFile.fileOption.map{ file =>
      val tiff = ImageIO.read(file)
      if(tiff == null){
        logger.error("Couldn't load tiff file. " + ImageIO.getImageReaders(file).toList.map(_.getClass.toString))
        throw new Exception("Couldn't load tiff file due to missing tif reader.")
      } else {
        val raster = tiff.getRaster
        val data = (raster.getDataBuffer().asInstanceOf[DataBufferByte]).getData()
        val bytesPerPixel = imageTypeToByteDepth(tiff.getType)
        TiffImageArray(tiff.getWidth, tiff.getHeight, bytesPerPixel, data)
      }
    }
  }
}