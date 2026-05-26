package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.models.{DataRequest, VoxelPosition}
import com.scalableminds.util.tools.Full
import play.api.libs.json.{Json, OFormat}

import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

case class Histogram(elementCounts: Array[Long], min: Double, max: Double)
object Histogram { implicit val jsonFormat: OFormat[Histogram] = Json.format[Histogram] }

class FindDataService @Inject()(dataServicesHolder: BinaryDataServiceHolder)(implicit ec: ExecutionContext)
    extends DataConverter
    with DataFinder
    with FoxImplicits {

  private lazy val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService

  def findPositionWithData(datasetId: ObjectId, dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit tc: TokenContext): Fox[Option[(Vec3Int, Vec3Int)]] =
    for {
      positionAndMagOpt <- checkAllPositionsForData(datasetId, dataSourceId, dataLayer)
    } yield positionAndMagOpt

  private def getDataFor(datasetId: ObjectId,
                         dataSourceId: DataSourceId,
                         dataLayer: DataLayer,
                         position: Vec3Int,
                         mag: Vec3Int)(implicit tc: TokenContext): Fox[Array[Byte]] = {
    val request = DataRequest(
      VoxelPosition(position.x, position.y, position.z, mag),
      DataLayer.bucketLength,
      DataLayer.bucketLength,
      DataLayer.bucketLength
    )
    binaryDataService.handleDataRequest(
      DataServiceDataRequest(Some(datasetId),
                             Some(dataSourceId),
                             dataLayer,
                             request.cuboid(dataLayer),
                             request.settings))
  }

  private def concatenateBuckets(buckets: Seq[Array[Byte]]): Array[Byte] =
    buckets.foldLeft(Array[Byte]()) { (acc, i) =>
      {
        acc ++ i
      }
    }

  private def getConcatenatedDataFor(datasetId: ObjectId,
                                     dataSourceId: DataSourceId,
                                     dataLayer: DataLayer,
                                     positions: List[Vec3Int],
                                     mag: Vec3Int)(implicit tc: TokenContext) =
    for {
      dataBucketWise: Seq[Array[Byte]] <- Fox.fromFuture(
        Fox.sequenceOfFulls(positions.map(getDataFor(datasetId, dataSourceId, dataLayer, _, mag))))
      _ <- Fox.fromBool(dataBucketWise.nonEmpty) ?~> Msg.Dataset.loadingDataFailed
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

  private def checkAllPositionsForData(datasetId: ObjectId, dataSourceId: DataSourceId, dataLayer: DataLayer)(
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
        data <- getDataFor(datasetId, dataSourceId, dataLayer, position, mag)
        position <- getPositionOfNonZeroData(data, position, dataLayer.bytesPerElement).toFox
      } yield position

    def magIter(positions: List[Vec3Int], remainingMags: Seq[Vec3Int]): Fox[Option[(Vec3Int, Vec3Int)]] =
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

  def createHistogram(datasetId: ObjectId, dataSourceId: DataSourceId, dataLayer: DataLayer)(
      implicit tc: TokenContext): Fox[Seq[Histogram]] =
    if (dataLayer.resolutions.nonEmpty) {
      val positions = createPositions(dataLayer, 2).distinct
      histogramForPositions(datasetId, dataSourceId, dataLayer, positions, dataLayer.resolutions.minBy(_.maxDim))
    } else
      Fox.failure(Msg.Dataset.noMags)

  private def histogramForPositions(datasetId: ObjectId,
                                    dataSourceId: DataSourceId,
                                    dataLayer: DataLayer,
                                    positions: List[Vec3Int],
                                    mag: Vec3Int)(implicit tc: TokenContext): Fox[Seq[Histogram]] =
    for {
      dataConcatenated <- getConcatenatedDataFor(datasetId, dataSourceId, dataLayer, positions, mag) ?~> Msg.Dataset.loadingDataFailed
      isUint24 = dataLayer.elementClass == ElementClass.uint24
      convertedData = filterZeroes(convertData(dataConcatenated, dataLayer.elementClass), skip = isUint24)
    } yield calculateHistogramValues(convertedData, dataLayer.elementClass)

  def calculateHistogramValues(data: Array[? >: Byte & Short & Int & Long & Float],
                               elementClass: ElementClass.Value): Seq[Histogram] = {
    val bytesPerElement = ElementClass.bytesPerElement(elementClass)
    val isUint24 = elementClass == ElementClass.uint24
    val isSigned = ElementClass.isSigned(elementClass)
    val counts = if (isUint24) Array.ofDim[Long](768) else Array.ofDim[Long](256)
    var extrema: (Double, Double) =
      if (isSigned)
        (-math.pow(2, 8 * bytesPerElement - 1), math.pow(2, 8 * bytesPerElement - 1) - 1)
      else
        (0, math.pow(2, 8 * bytesPerElement) - 1)

    if (data.nonEmpty) {
      data match {
        case byteData: Array[Byte] =>
          if (isUint24) {
            for (i <- byteData.indices by 3) {
              counts(histogramBinForByte(byteData(i), isSigned = false)) += 1
              counts(histogramBinForByte(byteData(i + 1), isSigned = false) + 256) += 1
              counts(histogramBinForByte(byteData(i + 2), isSigned = false) + 512) += 1
            }
            extrema = (0, 255)
          } else
            byteData.foreach(el => counts(histogramBinForByte(el, isSigned)) += 1)
        case shortData: Array[Short] =>
          shortData.foreach(el => counts(histogramBinForShort(el, isSigned)) += 1)
        case intData: Array[Int] =>
          intData.foreach(el => counts(histogramBinForInt(el, isSigned)) += 1)
        case longData: Array[Long] =>
          longData.foreach(el => counts(histogramBinForLong(el, isSigned)) += 1)
        case floatData: Array[Float] =>
          val (min, max) = floatData.foldLeft((floatData(0), floatData(0))) {
            case ((currMin, currMax), e) => (math.min(currMin, e), math.max(currMax, e))
          }
          val binSize = (max - min) / 255
          val finalBinSize = if (math.abs(binSize) < 1e-7f) 1f else binSize
          floatData.foreach(el => counts(histogramBinForFloat(el, min, finalBinSize)) += 1)
          extrema = (min, max)
      }
    }
    if (isUint24) {
      val listOfCounts = counts.grouped(256).toList
      listOfCounts.map(counts => {
        counts(0) = 0;
        Histogram(counts, extrema._1, extrema._2)
      })
    } else
      List(Histogram(counts, extrema._1, extrema._2))
  }

  private def histogramBinForByte(v: Byte, isSigned: Boolean): Int =
    if (isSigned) v.toInt + 128 else v & 0xFF

  private def histogramBinForShort(v: Short, isSigned: Boolean): Int =
    if (isSigned) (v >> 8) + 128 else (v.toInt & 0xFFFF) >> 8

  private def histogramBinForInt(v: Int, isSigned: Boolean): Int =
    if (isSigned) (v >> 24) + 128 else v >>> 24

  private def histogramBinForLong(v: Long, isSigned: Boolean): Int =
    if (isSigned) (v >> 56).toInt + 128 else (v >>> 56).toInt

  private def histogramBinForFloat(v: Float, min: Float, binSize: Float): Int =
    ((v - min) / binSize).floor.toInt
}
