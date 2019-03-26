package com.scalableminds.webknossos.datastore.services
import java.nio._

import com.google.inject.Inject
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.{DataRequest, VoxelPosition}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import net.liftweb.common.Full
import play.api.i18n.MessagesProvider

import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag
import Numeric.Implicits._



trait NumericTools {

  def mean[T: Numeric](xs: Iterable[T]): Double = xs.sum.toDouble / xs.size

  def variance[T: Numeric](xs: Iterable[T]): Double = {
    val avg = mean(xs)

    xs.map(_.toDouble).map(a => math.pow(a - avg, 2)).sum / xs.size
  }

  def stdDev[T: Numeric](xs: Iterable[T]): Double = math.sqrt(variance(xs))

}

class FindDataService @Inject()(dataServicesHolder: BinaryDataServiceHolder)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with NumericTools {
  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService
  var i = 0

  def findPositionWithData(dataSource: DataSource, dataLayer: DataLayer)(implicit m: MessagesProvider): Fox[Option[(Point3D, Point3D)]] =
    for {
      positionAndResolutionOpt <- checkAllPositionsForData(dataSource, dataLayer)
    } yield positionAndResolutionOpt

  private def convertDataToDouble(data: Array[Byte], elementClass: ElementClass.Value): Array[Double] = {
    elementClass match {
      case ElementClass.uint8 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte)).map(_.toDouble)
      case ElementClass.uint16 =>
        convertDataImpl[Short, ShortBuffer](
          data,
          DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort)).map(_.toDouble)
      case ElementClass.uint32 =>
        convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt)).map(_.toDouble)
      case ElementClass.uint64 =>
        convertDataImpl[Long, LongBuffer](data,
          DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity)).map(_.toDouble)
    }
  }

  private def convertData(data: Array[Byte], elementClass: ElementClass.Value): Array[_ >: Byte with Short with Int with Long] =
    elementClass match {
      case ElementClass.uint8 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint16 =>
        convertDataImpl[Short, ShortBuffer](
          data,
          DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
      case ElementClass.uint32 =>
        convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
      case ElementClass.uint64 =>
        convertDataImpl[Long, LongBuffer](data,
          DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
    }

  private def convertDataImpl[T: ClassTag, B <: Buffer](data: Array[Byte],
    dataTypeFunctor: DataTypeFunctors[T, B]): Array[T] = {
    val srcBuffer = dataTypeFunctor.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
    srcBuffer.rewind()
    val dstArray = Array.ofDim[T](srcBuffer.remaining())
    dataTypeFunctor.copyDataFn(srcBuffer, dstArray)
    dstArray
  }

  private def checkAllPositionsForData(dataSource: DataSource, dataLayer: DataLayer): Fox[Option[(Point3D, Point3D)]] = {

    def getExactDataOffset(data: Array[Byte]): Point3D = {
      val cubeLength = DataLayer.bucketLength / dataLayer.bytesPerElement
      val convertedData = convertData(data, dataLayer.elementClass)
      for {
        z <- 0 until cubeLength
        y <- 0 until cubeLength
        x <- 0 until cubeLength
      } {
        val voxelOffset = x + y * cubeLength + z * cubeLength * cubeLength
        if (convertedData(voxelOffset) != 0) return Point3D(x, y, z)
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

    def checkIfPositionHasData(position: Point3D, resolution: Point3D) = {
      val request = DataRequest(
        new VoxelPosition(position.x, position.y, position.z, resolution),
        DataLayer.bucketLength,
        DataLayer.bucketLength,
        DataLayer.bucketLength
      )
      for {
        data <- binaryDataService.handleDataRequest(
          DataServiceDataRequest(dataSource, dataLayer, None, request.cuboid(dataLayer), request.settings))
        if data.nonEmpty && data.exists(_ != 0)
      } yield position.move(getExactDataOffset(data))
    }

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




  def meanAndStdev(dataSource: DataSource, dataLayer: DataLayer)(implicit m: MessagesProvider): Fox[(Double, Double)] = {

    def getDataFor(position: Point3D, resolution: Point3D): Fox[Array[Byte]] = {
      val request = DataRequest(
        new VoxelPosition(position.x, position.y, position.z, resolution),
        DataLayer.bucketLength,
        DataLayer.bucketLength,
        DataLayer.bucketLength
      )
      binaryDataService.handleDataRequest(
        DataServiceDataRequest(dataSource, dataLayer, None, request.cuboid(dataLayer), request.settings))
    }

    def concatenateBuckets(buckets: Seq[Array[Byte]]): Array[Byte] = {
      buckets.foldLeft(Array[Byte]()) {
        (acc, i) => {
          println("concatenating bucket")
          acc ++ i
        }
      }
    }

    def filterValues(byte: Byte) = {
      //TODO
      true
    }

    def meanAndStdDevFor(positions: List[Point3D], resolution: Point3D): Fox[(Double, Double)] =
      for {
        dataBucketWise: Seq[Array[Byte]] <- Fox.serialCombined(positions)(pos => getDataFor(pos, resolution))
        _ = println(s"fetched ${dataBucketWise.length} buckets")
        dataConcatenated = concatenateBuckets(dataBucketWise)
        _ = println("concatenated data")
        dataFiltered = dataConcatenated.filter(filterValues)
        _ = println("filtered data")
        dataAsDoubles = convertDataToDouble(dataConcatenated, dataLayer.elementClass)
        dataAsInts = convertData(dataConcatenated, dataLayer.elementClass)
        _ = println("converted data to double")
      } yield (mean(dataAsDoubles), stdDev(dataAsDoubles))

    for {
      highestResolution <- dataLayer.resolutions.sortBy(_.maxDim).headOption.toFox
      meanAndStdDev <- meanAndStdDevFor(createPositions(dataLayer, 2).distinct, highestResolution)
    } yield meanAndStdDev
  }
}
