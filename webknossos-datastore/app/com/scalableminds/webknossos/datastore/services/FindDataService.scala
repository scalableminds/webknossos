package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits, Math}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.models.{DataRequest, VoxelPosition}
import net.liftweb.common.Full
import play.api.libs.json.{Json, OFormat}
import spire.math._

import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

case class Histogram(elementCounts: Array[Long], numberOfElements: Int, min: Double, max: Double)
object Histogram { implicit val jsonFormat: OFormat[Histogram] = Json.format[Histogram] }

class FindDataService @Inject()(dataServicesHolder: BinaryDataServiceHolder)(implicit ec: ExecutionContext)
    extends DataConverter
    with DataFinder
    with FoxImplicits {
  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService

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
      dataBucketWise: Seq[Array[Byte]] <- Fox
        .sequenceOfFulls(positions.map(getDataFor(dataSource, dataLayer, _, resolution)))
        .toFox
      _ <- bool2Fox(dataBucketWise.nonEmpty) ?~> "dataSet.noData"
      dataConcatenated = concatenateBuckets(dataBucketWise)
    } yield dataConcatenated

  private def createPositions(dataLayer: DataLayer, iterationCount: Int = 4) = {

    @tailrec
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

    Point3D(0, 0, 0) +: positionCreationIter((1 to iterationCount).toList, List[Point3D]())
  }

  private def checkAllPositionsForData(dataSource: DataSource,
                                       dataLayer: DataLayer): Fox[Option[(Point3D, Point3D)]] = {

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
        position <- getPositionOfNonZeroData(data, position, dataLayer.bytesPerElement)
      } yield position

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

  def findPositionWithData(dataSource: DataSource, dataLayer: DataLayer): Fox[Option[(Point3D, Point3D)]] =
    for {
      positionAndResolutionOpt <- checkAllPositionsForData(dataSource, dataLayer)
    } yield positionAndResolutionOpt

  def meanAndStdDev(dataSource: DataSource, dataLayer: DataLayer): Fox[(Double, Double)] = {

    def convertNonZeroDataToDouble(data: Array[Byte], elementClass: ElementClass.Value): Array[Double] =
      convertData(data, elementClass, filterZeroes = true) match {
        case d: Array[UByte]  => d.map(_.toDouble)
        case d: Array[UShort] => d.map(_.toDouble)
        case d: Array[UInt]   => d.map(_.toDouble)
        case d: Array[ULong]  => d.map(_.toDouble)
        case d: Array[Float]  => d.map(_.toDouble)
      }

    def meanAndStdDevForPositions(positions: List[Point3D], resolution: Point3D): Fox[(Double, Double)] =
      for {
        dataConcatenated <- getConcatenatedDataFor(dataSource, dataLayer, positions, resolution)
        dataAsDoubles = convertNonZeroDataToDouble(dataConcatenated, dataLayer.elementClass)
        _ <- bool2Fox(dataAsDoubles.nonEmpty) ?~> "dataSet.sampledOnlyBlack"
      } yield (Math.mean(dataAsDoubles), Math.stdDev(dataAsDoubles))

    for {
      _ <- bool2Fox(dataLayer.resolutions.nonEmpty) ?~> "dataSet.noResolutions"
      meanAndStdDev <- meanAndStdDevForPositions(createPositions(dataLayer, 2).distinct,
                                                 dataLayer.resolutions.minBy(_.maxDim))
    } yield meanAndStdDev
  }

  def createHistogram(dataSource: DataSource, dataLayer: DataLayer): Fox[List[Histogram]] = {

    def calculateHistogramValues(data: Array[_ >: UByte with UShort with UInt with ULong with Float],
                                 bytesPerElement: Int,
                                 isUint24: Boolean) = {
      val counts = if (isUint24) Array.ofDim[Long](768) else Array.ofDim[Long](256)
      var extrema: (Double, Double) = (0, math.pow(256, bytesPerElement) - 1)

      if (data.nonEmpty) {
        data match {
          case byteData: Array[UByte] =>
            if (isUint24) {
              for (i <- byteData.indices by 3) {
                counts(byteData(i).toInt) += 1
                counts(byteData(i + 1).toInt + 256) += 1
                counts(byteData(i + 2).toInt + 512) += 1
              }
              extrema = (0, 255)
            } else
              byteData.foreach(el => counts(el.toInt) += 1)
          case shortData: Array[UShort] =>
            shortData.foreach(el => counts((el / UShort(256)).toInt) += 1)
          case intData: Array[UInt] =>
            intData.foreach(el => counts((el / UInt(16777216)).toInt) += 1)
          case longData: Array[ULong] =>
            longData.foreach(el => counts((el / ULong(math.pow(2, 56).toLong)).toInt) += 1)
          case floatData: Array[Float] =>
            val (min, max) = floatData.foldLeft((floatData(0), floatData(0))) {
              case ((currMin, currMax), e) => (math.min(currMin, e), math.max(currMax, e))
            }
            val bucketSize = (max - min) / 255
            val finalBucketSize = if (bucketSize == 0f) 1f else bucketSize
            floatData.foreach(el => counts(((el - min) / finalBucketSize).floor.toInt) += 1)
            extrema = (min, max)
        }
      }
      if (isUint24) {
        val listOfCounts = counts.grouped(256).toList
        listOfCounts.map(counts => { counts(0) = 0; Histogram(counts, counts.sum.toInt, extrema._1, extrema._2) })
      } else
        List(Histogram(counts, data.length, extrema._1, extrema._2))
    }

    def histogramForPositions(positions: List[Point3D], resolution: Point3D) =
      for {
        dataConcatenated <- getConcatenatedDataFor(dataSource, dataLayer, positions, resolution) ?~> "dataSet.noData"
        isUint24 = dataLayer.elementClass == ElementClass.uint24
        convertedData = convertData(dataConcatenated, dataLayer.elementClass, filterZeroes = !isUint24)
      } yield calculateHistogramValues(convertedData, dataLayer.bytesPerElement, isUint24)

    if (dataLayer.resolutions.nonEmpty)
      histogramForPositions(createPositions(dataLayer, 2).distinct, dataLayer.resolutions.minBy(_.maxDim))
    else
      Fox.empty ?~> "dataSet.noResolutions"
  }
}
