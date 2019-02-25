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

class FindDataService @Inject()(dataServicesHolder: BinaryDataServiceHolder)(implicit ec: ExecutionContext)
    extends FoxImplicits {
  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService
  var i = 0

  def findPositionWithData(dataSource: DataSource, dataLayer: DataLayer)(implicit m: MessagesProvider) =
    for {
      positionOpt <- checkAllPositionsForData(dataSource, dataLayer)
    } yield positionOpt

  private def checkAllPositionsForData(dataSource: DataSource, dataLayer: DataLayer) = {

    def convertData(data: Array[Byte]) =
      dataLayer.elementClass match {
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

    def convertDataImpl[T: ClassTag, B <: Buffer](data: Array[Byte],
                                                  dataTypeFunctor: DataTypeFunctors[T, B]): Array[T] = {
      val srcBuffer = dataTypeFunctor.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
      srcBuffer.rewind()
      val dstArray = Array.ofDim[T](srcBuffer.remaining())
      dataTypeFunctor.copyDataFn(srcBuffer, dstArray)
      dstArray
    }

    def getExactDataOffset(data: Array[Byte]): Point3D = {
      val cubeLength = DataLayer.bucketLength / dataLayer.bytesPerElement
      val convertedData = convertData(data)
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

    def searchPositionIter(positions: List[Point3D]): Fox[Option[Point3D]] =
      positions match {
        case List() => Fox.successful(None)
        case head :: tail =>
          checkIfPositionHasData(head).futureBox.flatMap {
            case Full(pos) => Fox.successful(Some(pos))
            case _         => searchPositionIter(tail)
          }
      }

    def checkIfPositionHasData(position: Point3D) = {
      val request = DataRequest(
        new VoxelPosition(position.x, position.y, position.z, dataLayer.lookUpResolution(0)),
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

    searchPositionIter(createPositions(dataLayer).distinct)
  }

  private def createPositions(dataLayer: DataLayer) = {

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

    positionCreationIter((1 to 4).toList, List[Point3D]())
  }
}
