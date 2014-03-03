/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scalax.file.{PathMatcher, Path}
import braingames.binary.models._
import javax.imageio.ImageIO
import braingames.geometry.{BoundingBox, Scale, Point3D}
import java.io._
import braingames.binary.store.{FileDataStore, DataStore}
import braingames.binary.Logger._
import java.awt.image.{BufferedImage, DataBufferByte, DataBufferInt}
import braingames.util.ProgressTracking.ProgressTracker
import scala.collection.JavaConversions._
import javax.imageio.spi.IIORegistry
import com.twelvemonkeys.imageio.plugins.tiff.TIFFImageReaderSpi
import scala.Some
import braingames.binary.models.UnusableDataSource
import net.liftweb.common.Full
import scala.concurrent.Future
import braingames.util.BlockedArray3D
import play.api.libs.concurrent.Execution.Implicits._

object TiffDataSourceType extends DataSourceType with TiffDataSourceTypeHandler {
  val name = "tiff"

  def chanceOfInboxType(source: Path) = {
    (source ** "*.tif")
      .take(MaxNumberOfFilesForGuessing)
      .size.toFloat / MaxNumberOfFilesForGuessing
  }
}


object KnossosMultiResCreator {
  val CubeSize = 128

  val FileSize = CubeSize * CubeSize * CubeSize

  val InterpolationNeighbours = Array((0,0,0), (0,0,1), (0,1,0), (0,1,1), (1,0,0), (1,0,1), (1,1,0), (1,1,1)).map(Point3D.apply)

  private def downScale(data: BlockedArray3D[Byte], width: Int, height: Int, depth: Int, bytesPerElement: Int ) = {
    // must be super fast is it is called for each pixel
    @inline
    def average(elements: Array[Array[Byte]]) = {
      val sum = Array.fill(bytesPerElement)(0)
      val result = new Array[Byte](bytesPerElement)

      val i = 0
      while(i < bytesPerElement){
        var idx = 0
        while(idx < elements.size){
          sum(i) = sum(i) + elements(idx)(i)
          idx += 1
        }
        result(i) = (sum(i) / elements.size).toByte
      }
      result
    }

    val size = width * height * depth
    val result = new Array[Byte](size)
    var idx = 0
    while(idx < size){
      val base = Point3D(idx / depth / height, idx / depth % height, idx % depth)
      val points = InterpolationNeighbours.map{ movement =>
        data(base.move(movement))
      }
      average(points).copyToArray(result, idx * bytesPerElement)
      idx += 1
    }
    result
  }

  def loadCubes(dataStore: FileDataStore, target: Path, dataSetId: String, start: Point3D, resolution: Int, fileSize: Int, neighbours: Array[Point3D]): Future[List[Array[Byte]]] = {
    Future.traverse(neighbours.toList){ movement =>
      val cubePosition = start.move(movement)
      dataStore.load(target, dataSetId, resolution, cubePosition, fileSize).map{
        case Full(data) =>
          data.padTo(fileSize, 0.toByte)
        case _ =>
          Array.fill(fileSize)(0.toByte)
      }
    }
  }

  def createResolutions(source: Path, target: Path, dataSetId: String, bytesPerElement: Int, baseResolution: Int, resolutions: Int, boundingBox: BoundingBox): Future[_] = {
    def createNextResolution(resolution: Int) = {
      val targetResolution = baseResolution * 2
      val dataStore = new FileDataStore
      val points = for {
        x <- boundingBox.topLeft.x.to(boundingBox.bottomRight.x, CubeSize * targetResolution)
        y <- boundingBox.topLeft.y.to(boundingBox.bottomRight.y, CubeSize * targetResolution)
        z <- boundingBox.topLeft.z.to(boundingBox.bottomRight.z, CubeSize * targetResolution)
      } yield Point3D(x,y,z)

      points.foldLeft(Future.successful[Any](0)){
        case (f, p) => f.flatMap{ _ =>
          val base = p.scale(1.toFloat / CubeSize / baseResolution)
          val goal = p.scale(1.toFloat / CubeSize / targetResolution)
          loadCubes(dataStore, target, dataSetId, base, baseResolution, FileSize, InterpolationNeighbours).flatMap{ cubes =>
            val block = BlockedArray3D[Byte](cubes.toVector, CubeSize, CubeSize, CubeSize, 2, 2, 2, bytesPerElement, 0)
            val data = downScale(block, CubeSize, CubeSize, CubeSize, bytesPerElement)
            dataStore.save(target, dataSetId, targetResolution, goal, data)
          }
        }
      }
    }

    val resolutionsToCreate = List.fill(resolutions - 2)(2).scanLeft(baseResolution)(_ * _)
    resolutionsToCreate.foldLeft(Future.successful[Any](1)){
      case (previous, resolution) =>
        previous.flatMap(_ => createNextResolution(resolution))
    }
  }
}

trait TiffDataSourceTypeHandler extends DataSourceTypeHandler {
  val Target = "target"

  val DefaultScale = Scale(200, 200, 200)

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


  case class TiffImageArray(width: Int, height: Int, bytesPerPixel: Int, data: Array[Byte])

  case class TiffStackInfo(boundingBox: BoundingBox, bytesPerPixel: Int)

  protected def prepareTargetPath(target: Path): Unit = {
    target.deleteRecursively()
    target.createDirectory()
  }

  protected def targetPathForDataSource(unusableDataSource: UnusableDataSource, layerType: DataLayerType) =
    unusableDataSource.sourceFolder / Target / layerType.name

  protected def elementClass(bytesPerPixel: Int) =
    s"uint${bytesPerPixel * 8}"

  def importDataSource(unusableDataSource: UnusableDataSource, progress: ProgressTracker): Option[DataSource] = {
    val layerType = DataLayer.COLOR
    val baseDir = (unusableDataSource.sourceFolder / Target).toAbsolute.path
    val targetPath = targetPathForDataSource(unusableDataSource, layerType)

    prepareTargetPath(targetPath)

    convertToKnossosStructure(unusableDataSource.id, unusableDataSource.sourceFolder, targetPath, progress).map {
      stackInfo =>
        val section = DataLayerSection(layerType.name, layerType.name, List(1, 2), stackInfo.boundingBox, stackInfo.boundingBox)
        val elements = elementClass(stackInfo.bytesPerPixel)
        val layer = DataLayer(layerType.name, baseDir, None, elements, None, List(section))
        DataSource(
          unusableDataSource.id,
          baseDir,
          DefaultScale,
          dataLayers = List(layer))

    }

  }

  protected def extractImageInfo(tiffs: List[Path]): Option[TiffImageArray] = {
    tiffs match {
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
    extractImageInfo(tiffs.toList) match {
      case Some(tiffInfo) =>
        val tiles = tiffs.toList.sortBy(_.name).toIterator.zipWithIndex.flatMap {
          case (t, idx) =>
            progress.track((idx + 1).toFloat / depth)
            tiffToColorArray(t).map(_.data)
        }
        TileToCubeWriter(id, 1, target, tiffInfo.width, tiffInfo.height, tiffInfo.bytesPerPixel, tiles).convertToCubes()
        val boundingBox = BoundingBox(Point3D(0, 0, 0), tiffInfo.width, tiffInfo.height, depth)
        //KnossosMultiResCreator.createResolutions(target, target, id, tiffInfo.bytesPerPixel, 1, 2, boundingBox)
        Some(TiffStackInfo(boundingBox, tiffInfo.bytesPerPixel))
      case _ =>
        logger.warn("No tiff files found")
        None
    }
  }

  private class KnossosWriterCache(id: String, resolution: Int, folder: Path) {
    var cache = Map.empty[Point3D, FileOutputStream]

    def get(block: Point3D): FileOutputStream = {
      cache.get(block).getOrElse {
        val f = fileForPosition(block)
        cache += block -> f
        f
      }
    }

    private def fileForPosition(block: Point3D): FileOutputStream = {
      val path = DataStore.knossosFilePath(folder, id, resolution, block)
      path.createFile(failIfExists = false)
      path.fileOption match {
        case Some(f) =>
          new FileOutputStream(f, true)
        case None =>
          throw new Exception("Couldn't open file: " + path.path)
      }
    }

    def closeAll() = {
      cache.mapValues(_.close())
      cache = Map.empty
    }
  }

  case class TileToCubeWriter(id: String, resolutions: Int, target: Path, width: Int, height: Int, bytesPerPixel: Int, tiles: Iterator[Array[Byte]]) {
    val CubeSize = 128

    def convertToCubes(cubeSize: Int = 128) = {
      val fileCache = new KnossosWriterCache(id, 1, target)
      tiles.zipWithIndex.foreach {
        case (tile, idx) =>
          writeTile(tile, idx, width, height, fileCache)
      }
      fileCache.closeAll()
    }

    private def fillUpToKnossosSize(tile: Array[Byte], xs: Int, ys: Int, width: Int, height: Int, bytesPerPixel: Int) = {
      // how many bytes are missing in each x row
      val destWidth = xs * CubeSize * bytesPerPixel
      val fillUpSize = destWidth - width * bytesPerPixel
      if (fillUpSize == 0)
        tile
      else {
        val size = destWidth * CubeSize * ys
        val result = new Array[Byte](size)
        val placeholder = Array.fill(fillUpSize)(0.toByte)
        tile.grouped(width * bytesPerPixel).zipWithIndex.foreach {
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
      }
    }
  }

  def imageTypeToByteDepth(typ: Int) = {
    typ match {
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
    tiffFile.fileOption.map {
      file =>
        val tiff = ImageIO.read(file)
        if (tiff == null) {
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