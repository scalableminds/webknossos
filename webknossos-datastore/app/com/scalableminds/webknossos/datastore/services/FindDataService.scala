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
import play.api.i18n.MessagesProvider
import spire.math._

import scala.concurrent.ExecutionContext
import scala.reflect.ClassTag

class FindDataService @Inject()(dataServicesHolder: BinaryDataServiceHolder)(implicit ec: ExecutionContext)
    extends FoxImplicits {
  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService

  private def convertData(data: Array[Byte],
                          elementClass: ElementClass.Value,
                          filterZeroes: Boolean = false): Array[_ >: UByte with UShort with UInt with ULong] =
    elementClass match {
      case ElementClass.uint8 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
          .map(UByte(_))
          .filter(filterZeroes && _ != UByte(0))
      case ElementClass.uint16 =>
        convertDataImpl[Short, ShortBuffer](data,
                                            DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
          .map(UShort(_))
          .filter(filterZeroes && _ != UShort(0))
      case ElementClass.uint24 =>
        convertDataImpl[Byte, ByteBuffer](combineBytes(data),
                                          DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
          .map(UByte(_))
          .filter(filterZeroes && _ != UByte(0))
      case ElementClass.uint32 =>
        convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
          .map(UInt(_))
          .filter(filterZeroes && _ != UInt(0))
      case ElementClass.uint64 =>
        convertDataImpl[Long, LongBuffer](data, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
          .map(ULong(_))
          .filter(filterZeroes && _ != ULong(0))
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
      convertData(data, elementClass, filterZeroes = true) match {
        case d: Array[UByte]  => d.map(_.toDouble)
        case d: Array[UShort] => d.map(_.toDouble)
        case d: Array[UInt]   => d.map(_.toDouble)
        case d: Array[ULong]  => d.map(_.toDouble)
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

    def calculateHistogramValues(data: Array[_ >: UByte with UShort with UInt with ULong]) = {
      val counts = Array.ofDim[Long](256)
      data match {
        case byteData: Array[UByte] =>
          byteData.foreach(el => counts(el.toInt) += 1)
        case shortData: Array[UShort] =>
          shortData.foreach(el => counts((el / UShort(256)).toInt) += 1)
        case intData: Array[UInt] =>
          intData.foreach(el => counts((el / UInt(16777216)).toInt) += 1)
        case longData: Array[ULong] =>
          longData.foreach(el => counts((el / ULong(math.pow(2, 56).toLong)).toInt) += 1)
      }
      counts
    }

    def histogramForPositions(positions: List[Point3D], resolution: Point3D) =
      for {
        dataConcatenated <- getConcatenatedDataFor(dataSource, dataLayer, positions, resolution)
        convertedData = convertData(dataConcatenated, dataLayer.elementClass, filterZeroes = true)
      } yield (calculateHistogramValues(convertedData), convertedData.length)

    if (dataLayer.resolutions.nonEmpty)
      histogramForPositions(createPositions(dataLayer, 2).distinct, dataLayer.resolutions.minBy(_.maxDim))
    else
      Fox.empty
  }
}
