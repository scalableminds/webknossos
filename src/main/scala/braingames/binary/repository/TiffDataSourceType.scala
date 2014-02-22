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
import java.awt.image.{DataBufferByte, DataBufferInt}
import com.tomgibara.imageio.impl.tiff.EmptyImage
import braingames.util.ProgressTracking.ProgressTracker

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

  case class TiffImageArray(width: Int, height: Int, data: Array[Byte])

  def importDataSource(unusableDataSource: UnusableDataSource, progress: ProgressTracker): Option[DataSource] = {
    val layerType = DataLayer.COLOR
    val targetPath = unusableDataSource.sourceFolder / Target / layerType.name

    targetPath.deleteRecursively()
    targetPath.createDirectory()

    convertToKnossosStructure(unusableDataSource.id, unusableDataSource.sourceFolder, targetPath, progress).map{ boundingBox =>
      val section = DataLayerSection(layerType.name, layerType.name, List(1), boundingBox, boundingBox)
      val layer = DataLayer(layerType.name, None, "uint8", None, List(section))
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

  def convertToKnossosStructure(id: String, source: Path, target: Path, progress: ProgressTracker): Option[BoundingBox] = {
    val tiffs = (source * "*.tif")
    val depth = tiffs.size
    extractImageInfo(tiffs.toList) match{
      case Some(tiffInfo) =>
        val tiles = tiffs.toList.sortBy(_.name).toIterator.zipWithIndex.flatMap{
          case (t, idx) =>
            progress.track((idx+1).toFloat / depth)
            tiffToColorArray(t).map(_.data)
        }
        TileToCubeWriter(id, 1, target, tiffInfo.width, tiffInfo.height, 3, tiles ).convertToCubes()
        Some(BoundingBox(Point3D(0,0,0), tiffInfo.width, tiffInfo.height, depth))
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

  case class TileToCubeWriter(id: String, resolution: Int, target: Path, width: Int, height: Int, bytesPerPoint: Int, tiles: Iterator[Array[Byte]]){
    val CubeSize = 128


    def convertToCubes(cubeSize: Int = 128) = {
      val fileCache = new KnossosWriterCache(id, resolution, target)
      tiles.zipWithIndex.foreach{
        case (tile, idx) =>
          writeTile(tile, idx, width, height, bytesPerPoint, fileCache)
      }
      fileCache.closeAll()
    }

    private def writeTile(tile: Array[Byte], layerNumber: Int, width: Int, height: Int, bytesPerPoint: Int, files: KnossosWriterCache): Unit = {
      val xs = tile.length / height / CubeSize
      val ys = tile.length / width / CubeSize

      val sliced = Array.fill(ys * xs)(Vector.empty[Array[Byte]])

      tile.grouped(CubeSize).zipWithIndex.foreach{
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

  @inline
  def intToBytes(i: Int, bytes: Int) = {
    val alpha = ((i >> 24) & 0xff).toByte
    val red = ((i >> 16) & 0xff).toByte
    val green = ((i >> 8) & 0xff).toByte
    val blue = ((i) & 0xff).toByte
    if(bytes == 4)
      Array(alpha, red, green, blue)
    else if(bytes == 3)
      Array(red, green, blue)
    else if(bytes == 1)
      Array(red)
    else
      throw new Exception("Invalid bytes per point: "+ bytes)
  }

  def tiffToColorArray(tiffFile: Path): Option[TiffImageArray] = {
    tiffFile.fileOption.map{ file =>
      val tiff = ImageIO.read(file)
      val raster = tiff.getRaster
      val data = (raster.getDataBuffer().asInstanceOf[DataBufferByte]).getData()
      TiffImageArray(tiff.getWidth, tiff.getHeight, data)
    }
  }
}