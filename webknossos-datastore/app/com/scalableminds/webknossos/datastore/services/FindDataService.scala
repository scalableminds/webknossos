package com.scalableminds.webknossos.datastore.services
import java.nio._

import com.google.inject.Inject
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.{DataRequest, VoxelPosition}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.util.tools.Math
import net.liftweb.common.Full
import play.api.i18n.{Messages, MessagesProvider}

import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag

class FindDataService @Inject()(dataServicesHolder: BinaryDataServiceHolder)(implicit ec: ExecutionContext)
    extends FoxImplicits {
  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService

  private def convertData(data: Array[Byte],
                          elementClass: ElementClass.Value): Array[_ >: Byte with Short with Int with Long] =
    elementClass match {
      case ElementClass.uint8 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint16 =>
        convertDataImpl[Short, ShortBuffer](data,
                                            DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
      case ElementClass.uint24 =>
        convertDataImpl[Byte, ByteBuffer](combineBytes(data),
                                          DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint32 =>
        convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
      case ElementClass.uint64 =>
        convertDataImpl[Long, LongBuffer](data, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
    }

  private def convertDataImpl[T: ClassTag, B <: Buffer](data: Array[Byte],
                                                        dataTypeFunctor: DataTypeFunctors[T, B]): Array[T] = {
    val srcBuffer = dataTypeFunctor.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
    srcBuffer.rewind()
    val dstArray = Array.ofDim[T](srcBuffer.remaining())
    dataTypeFunctor.copyDataFn(srcBuffer, dstArray)
    dstArray
  }

  private def combineBytes(data: Array[Byte], numBytes: Int = 3) = {
    val result = Array.ofDim[Byte](data.length / numBytes)
    for (i <- data.indices by numBytes) {
      var sum = 0
      for (j <- 0 until numBytes) {
        sum += data(i + j)
      }
      result(i / numBytes) = (sum / numBytes).toByte
    }
    result
  }

  private def getDataFor(dataSource: DataSource,
                         dataLayer: DataLayer,
                         position: Point3D,
                         resolution: Point3D): Fox[Array[Byte]] = {
    val request = DataRequest(
      new VoxelPosition(position.x, position.y, position.z, resolution),
      DataLayer.bucketLength,
      DataLayer.bucketLength,
      DataLayer.bucketLength
    )
    binaryDataService.handleDataRequest(
      DataServiceDataRequest(dataSource, dataLayer, None, request.cuboid(dataLayer), request.settings))
  }

  private def concatenateBuckets(buckets: Seq[Array[Byte]]): Array[Byte] =
    buckets.foldLeft(Array[Byte]()) { (acc, i) =>
      {
        acc ++ i
      }
    }

  private def getConcatenatedDataFor(dataSource: DataSource,
                                     dataLayer: DataLayer,
                                     positions: List[Point3D],
                                     resolution: Point3D) =
    for {
      dataBucketWise: Seq[Array[Byte]] <- Fox.serialCombined(positions)(pos =>
        getDataFor(dataSource, dataLayer, pos, resolution))
      dataConcatenated = concatenateBuckets(dataBucketWise)
    } yield dataConcatenated

  private def createPositions(dataLayer: DataLayer, iterationCount: Int = 4) = {

    def positionCreationIter(remainingRuns: List[Int], currentPositions: List[Point3D]): List[Point3D] = {

      def createPositionsFromExponent(exponent: Int) = {
        val power = math.pow(2, exponent).toInt
        val spaceBetweenWidth = dataLayer.boundingBox.width / power
        val spaceBetweenHeight = dataLayer.boundingBox.height / power
        val spaceBetweenDepth = dataLayer.boundingBox.depth / power
        val topLeft = dataLayer.boundingBox.topLeft

        if (spaceBetweenWidth < DataLayer.bucketLength && spaceBetweenHeight < DataLayer.bucketLength && spaceBetweenDepth < DataLayer.bucketLength) {
          None
        } else {
          Some(
            (for {
              z <- 1 until power
              y <- 1 until power
              x <- 1 until power
            } yield
              Point3D(topLeft.x + x * spaceBetweenWidth,
                      topLeft.y + y * spaceBetweenHeight,
                      topLeft.z + z * spaceBetweenDepth)).toList
          )
        }
      }

      remainingRuns match {
        case List() => currentPositions
        case head :: tail =>
          createPositionsFromExponent(head) match {
            case Some(values) => positionCreationIter(tail, currentPositions ::: values)
            case None         => currentPositions
          }
      }
    }

    positionCreationIter((1 to iterationCount).toList, List[Point3D]())
  }

  private def checkAllPositionsForData(dataSource: DataSource,
                                       dataLayer: DataLayer): Fox[Option[(Point3D, Point3D)]] = {

    def getExactDataOffset(data: Array[Byte]): Point3D = {
      val bytesPerElement = dataLayer.bytesPerElement
      val cubeLength = DataLayer.bucketLength / bytesPerElement
      for {
        z <- 0 until cubeLength
        y <- 0 until cubeLength
        x <- 0 until cubeLength
        scaledX = x * bytesPerElement
        scaledY = y * bytesPerElement
        scaledZ = z * bytesPerElement
      } {
        val voxelOffset = scaledX + scaledY * cubeLength + scaledZ * cubeLength * cubeLength
        if (data.slice(voxelOffset, voxelOffset + bytesPerElement).exists(_ != 0)) return Point3D(x, y, z)
      }
      Point3D(0, 0, 0)
    }

    def searchPositionIter(positions: List[Point3D], resolution: Point3D): Fox[Option[Point3D]] =
      positions match {
        case List() => Fox.successful(None)
        case head :: tail =>
          checkIfPositionHasData(head, resolution).futureBox.flatMap {
            case Full(pos) => Fox.successful(Some(pos))
            case _         => searchPositionIter(tail, resolution)
          }
      }

    def checkIfPositionHasData(position: Point3D, resolution: Point3D) =
      for {
        data <- getDataFor(dataSource, dataLayer, position, resolution)
        if data.nonEmpty && data.exists(_ != 0)
      } yield position.move(getExactDataOffset(data))

    def resolutionIter(positions: List[Point3D], remainingResolutions: List[Point3D]): Fox[Option[(Point3D, Point3D)]] =
      remainingResolutions match {
        case List() => Fox.successful(None)
        case head :: tail =>
          (for {
            foundPosition <- searchPositionIter(positions, head)
          } yield
            foundPosition match {
              case Some(position) => Fox.successful(Some((position, head)))
              case None           => resolutionIter(positions, tail)
            }).flatten
      }

    resolutionIter(createPositions(dataLayer).distinct, dataLayer.resolutions.sortBy(_.maxDim))
  }

  def findPositionWithData(dataSource: DataSource, dataLayer: DataLayer)(
      implicit m: MessagesProvider): Fox[Option[(Point3D, Point3D)]] =
    for {
      positionAndResolutionOpt <- checkAllPositionsForData(dataSource, dataLayer)
    } yield positionAndResolutionOpt

  def meanAndStdDev(dataSource: DataSource, dataLayer: DataLayer)(
      implicit m: MessagesProvider): Fox[(Double, Double)] = {

    def convertNonZeroDataToDouble(data: Array[Byte], elementClass: ElementClass.Value): Array[Double] =
      elementClass match {
        case ElementClass.uint8 =>
          convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
            .filter(_ != 0)
            .map(spire.math.UByte(_).toDouble)
        case ElementClass.uint16 =>
          convertDataImpl[Short, ShortBuffer](data,
                                              DataTypeFunctors[Short, ShortBuffer](
                                                _.asShortBuffer,
                                                _.get(_),
                                                _.toShort)).filter(_ != 0).map(spire.math.UShort(_).toDouble)
        case ElementClass.uint32 =>
          convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
            .filter(_ != 0)
            .map(spire.math.UInt(_).toDouble)
        case ElementClass.uint64 =>
          convertDataImpl[Long, LongBuffer](data,
                                            DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
            .filter(_ != 0)
            .map(spire.math.ULong(_).toDouble)
      }

    def meanAndStdDevForPositions(positions: List[Point3D], resolution: Point3D)(
        implicit m: MessagesProvider): Fox[(Double, Double)] =
      for {
        dataConcatenated <- getConcatenatedDataFor(dataSource, dataLayer, positions, resolution)
        dataAsDoubles = convertNonZeroDataToDouble(dataConcatenated, dataLayer.elementClass)
        _ <- Fox.bool2Fox(dataAsDoubles.nonEmpty) ?~> "dataSet.sampledOnlyBlack"
      } yield (Math.mean(dataAsDoubles), Math.stdDev(dataAsDoubles))

    for {
      _ <- bool2Fox(dataLayer.resolutions.nonEmpty) ?~> "dataSet.noResolutions"
      meanAndStdDev <- meanAndStdDevForPositions(createPositions(dataLayer, 2).distinct,
                                                 dataLayer.resolutions.minBy(_.maxDim))
    } yield meanAndStdDev
  }

  def createHistogram(dataSource: DataSource, dataLayer: DataLayer) = {
    def createHistogram(data: Array[_ >: Byte with Short with Int with Long], width: Int = 256) = {
      val counts = Array.ofDim[Long](width)
      var min = Long.MaxValue
      var max = Long.MinValue
      data match {
        case byteData: Array[Byte] =>
          byteData.foreach { el =>
            min = math.min(el, min); max = math.max(el, max)
          }
        case shortData: Array[Short] =>
          shortData.foreach { el =>
            min = math.min(el, min); max = math.max(el, max)
          }
        case intData: Array[Int] =>
          intData.foreach { el =>
            min = math.min(el, min); max = math.max(el, max)
          }
        case longData: Array[Long] =>
          longData.foreach { el =>
            min = math.min(el, min); max = math.max(el, max)
          }
      }
      val bucketWidth = math.ceil((max - min + 1) / width.toDouble).toInt
      data match {
        case byteData: Array[Byte] =>
          byteData.filter(_ != 0).foreach(el => counts(((el - min) / bucketWidth).toInt) += 1)
        case shortData: Array[Short] =>
          shortData.filter(_ != 0).foreach(el => counts(((el - min) / bucketWidth).toInt) += 1)
        case intData: Array[Int] => intData.filter(_ != 0).foreach(el => counts(((el - min) / bucketWidth).toInt) += 1)
        case longData: Array[Long] =>
          longData.filter(_ != 0).foreach(el => counts(((el - min) / bucketWidth).toInt) += 1)
      }
      counts
    }

    def histogramForPositions(positions: List[Point3D], resolution: Point3D) =
      for {
        dataConcatenated <- getConcatenatedDataFor(dataSource, dataLayer, positions, resolution)
        convertedData = convertData(dataConcatenated, dataLayer.elementClass)
      } yield (createHistogram(convertedData), convertedData.length)

    for {
      _ <- bool2Fox(dataLayer.resolutions.nonEmpty)
      histogramAndCount <- histogramForPositions(createPositions(dataLayer, 2).distinct,
                                                 dataLayer.resolutions.minBy(_.maxDim))
    } yield histogramAndCount
  }
}
