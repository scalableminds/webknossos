package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.models.{DataRequest, VoxelPosition}
import com.scalableminds.util.tools.Full
import play.api.libs.json.{Json, OFormat}
import spire.math.{UByte, UInt, ULong, UShort}

import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

case class Histogram(elementCounts: Array[Long], numberOfElements: Int, min: Double, max: Double)
object Histogram { implicit val jsonFormat: OFormat[Histogram] = Json.format[Histogram] }

class FindDataService @Inject()(dataServicesHolder: BinaryDataServiceHolder)(implicit ec: ExecutionContext)
    extends DataConverter
    with DataFinder
    with FoxImplicits {
  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService

  private def getDataFor(dataSourceId: DataSourceId, dataLayer: DataLayer, position: Vec3Int, mag: Vec3Int)(
      implicit tc: TokenContext): Fox[Array[Byte]] = {
    val request = DataRequest(
      VoxelPosition(position.x, position.y, position.z, mag),
      DataLayer.bucketLength,
      DataLayer.bucketLength,
      DataLayer.bucketLength
    )
    binaryDataService.handleDataRequest(
      DataServiceDataRequest(Some(dataSourceId), dataLayer, request.cuboid(dataLayer), request.settings))
  }

  private def concatenateBuckets(buckets: Seq[Array[Byte]]): Array[Byte] =
    buckets.foldLeft(Array[Byte]()) { (acc, i) =>
      {
        acc ++ i
      }
    }

  private def getConcatenatedDataFor(dataSourceId: DataSourceId,
                                     dataLayer: DataLayer,
                                     positions: List[Vec3Int],
                                     mag: Vec3Int)(implicit tc: TokenContext) =
    for {
      dataBucketWise: Seq[Array[Byte]] <- Fox.fromFuture(
        Fox.sequenceOfFulls(positions.map(getDataFor(dataSourceId, dataLayer, _, mag))))
      _ <- Fox.fromBool(dataBucketWise.nonEmpty) ?~> "dataset.noData"
      dataConcatenated = concatenateBuckets(dataBucketWise)
    } yield dataConcatenated

  private def createPositions(dataLayer: DataLayer, iterationCount: Int = 4) = {

    @tailrec
    def positionCreationIter(remainingRuns: List[Int], currentPositions: List[Vec3Int]): List[Vec3Int] = {

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
              Vec3Int(topLeft.x + x * spaceBetweenWidth,
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

    val positions = positionCreationIter((1 to iterationCount).toList, List[Vec3Int]()) :+ dataLayer.boundingBox.topLeft
    positions.map(_.alignWithGridFloor(Vec3Int.full(DataLayer.bucketLength))).distinct
  }

  private def checkAllPositionsForData(dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit tc: TokenContext): Fox[Option[(Vec3Int, Vec3Int)]] = {

    def searchPositionIter(positions: List[Vec3Int], mag: Vec3Int): Fox[Option[Vec3Int]] =
      positions match {
        case List() => Fox.successful(None)
        case head :: tail =>
          checkIfPositionHasData(head, mag).shiftBox.flatMap {
            case Full(pos) => Fox.successful(Some(pos))
            case _         => searchPositionIter(tail, mag)
          }
      }

    def checkIfPositionHasData(position: Vec3Int, mag: Vec3Int) =
      for {
        data <- getDataFor(dataSourceId, dataLayer, position, mag)
        position <- getPositionOfNonZeroData(data, position, dataLayer.bytesPerElement).toFox
      } yield position

    def magIter(positions: List[Vec3Int], remainingMags: List[Vec3Int]): Fox[Option[(Vec3Int, Vec3Int)]] =
      remainingMags match {
        case List() => Fox.successful(None)
        case head :: tail =>
          (for {
            foundPosition <- searchPositionIter(positions, head)
          } yield
            foundPosition match {
              case Some(position) => Fox.successful(Some((position, head)))
              case None           => magIter(positions, tail)
            }).flatten
      }

    magIter(createPositions(dataLayer).distinct, dataLayer.resolutions.sortBy(_.maxDim))
  }

  def findPositionWithData(dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit tc: TokenContext): Fox[Option[(Vec3Int, Vec3Int)]] =
    for {
      positionAndMagOpt <- checkAllPositionsForData(dataSourceId, dataLayer)
    } yield positionAndMagOpt

  def createHistogram(dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit tc: TokenContext): Fox[List[Histogram]] = {

    def calculateHistogramValues(
        data: Array[_ >: UByte with Byte with UShort with Short with UInt with Int with ULong with Long with Float],
        bytesPerElement: Int,
        elementClass: ElementClass.Value) = {
      val isUint24 = dataLayer.elementClass == ElementClass.uint24
      val counts = if (isUint24) Array.ofDim[Long](768) else Array.ofDim[Long](256)
      var extrema: (Double, Double) =
        (
          if (ElementClass.isSigned(elementClass))
            (-math.pow(2, 8 * bytesPerElement - 1), math.pow(2, 8 * bytesPerElement - 1) - 1)
          else
            (0, math.pow(2, 8 * bytesPerElement) - 1)
        )

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
          case byteData: Array[Byte] => {
            byteData.foreach(el => counts(el.toInt + 128) += 1)
          }
          case shortData: Array[UShort] =>
            shortData.foreach(el => counts((el / UShort(256)).toInt) += 1)
          case shortData: Array[Short] =>
            shortData.foreach(el => counts((el / 256.toShort + 128).toInt) += 1)
          case uintData: Array[UInt] =>
            uintData.foreach(el => counts((el / UInt(16777216)).toInt) += 1)
          case intData: Array[Int] =>
            intData.foreach(el => counts((el / 16777216 + 128).toInt) += 1)
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
        listOfCounts.map(counts => {
          counts(0) = 0; Histogram(counts, counts.sum.toInt, extrema._1, extrema._2)
        })
      } else
        List(Histogram(counts, data.length, extrema._1, extrema._2))
    }

    def histogramForPositions(positions: List[Vec3Int], mag: Vec3Int) =
      for {
        dataConcatenated <- getConcatenatedDataFor(dataSourceId, dataLayer, positions, mag) ?~> "dataset.noData"
        isUint24 = dataLayer.elementClass == ElementClass.uint24
        convertedData = toUnsignedIfNeeded(
          filterZeroes(convertData(dataConcatenated, dataLayer.elementClass), skip = isUint24),
          ElementClass.isSigned(dataLayer.elementClass)
        )
      } yield calculateHistogramValues(convertedData, dataLayer.bytesPerElement, dataLayer.elementClass)

    if (dataLayer.resolutions.nonEmpty)
      histogramForPositions(createPositions(dataLayer, 2).distinct, dataLayer.resolutions.minBy(_.maxDim))
    else
      Fox.empty ?~> "dataset.noMags"
  }
}
