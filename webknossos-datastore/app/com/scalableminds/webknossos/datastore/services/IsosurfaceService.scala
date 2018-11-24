package com.scalableminds.webknossos.datastore.services

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.{AskTimeoutException, ask, pipe}
import akka.routing.RoundRobinPool
import akka.util.Timeout
import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D, Vector3I}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest, DataServiceMappingRequest, DataServiceRequestSettings}
import net.liftweb.common.{Box, Failure}
import java.nio._

import scala.collection.mutable
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.reflect.ClassTag

case class IsosurfaceRequest(
                              dataSource: DataSource,
                              dataLayer: SegmentationLayer,
                              cuboid: Cuboid,
                              segmentId: Long,
                              voxelDimensions: Vector3I,
                              mapping: Option[String] = None
                            )

case class DataTypeFunctors[T, B](
                                   getTypedBufferFn: ByteBuffer => B,
                                   copyDataFn: (B, Array[T]) => Unit,
                                   fromLong: Long => T
                                 )

class IsosurfaceActor(val service: IsosurfaceService, val timeout: FiniteDuration) extends Actor {

  def receive = {
    case request: IsosurfaceRequest =>
      sender() ! Await.result(service.requestIsosurface(request).futureBox, timeout)
    case _ =>
        sender ! Failure("Unexpected message sent to IsosurfaceActor.")
  }
}

class IsosurfaceService @Inject()(
                                   actorSystem: ActorSystem,
                                   dataServicesHolder: DataServicesHolder
                                 )(implicit ec: ExecutionContext) extends FoxImplicits {

  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService
  val mappingService: MappingService = dataServicesHolder.mappingService

  implicit val timeout: Timeout = Timeout(30 seconds)

  val actor = actorSystem.actorOf(RoundRobinPool(1).props(Props(new IsosurfaceActor(this, timeout.duration))))

  def requestIsosurfaceViaActor(request: IsosurfaceRequest): Fox[Array[Float]] = {
    actor.ask(request).mapTo[Box[Array[Float]]].recover {
      case e: Exception => Failure(e.getMessage)
    }
  }

  def requestIsosurface(request: IsosurfaceRequest): Fox[Array[Float]] = {
    request.dataLayer.elementClass match {
      case ElementClass.uint8 =>
        generateIsosurfaceImpl[Byte, ByteBuffer](request, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint16 =>
        generateIsosurfaceImpl[Short, ShortBuffer](request, DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
      case ElementClass.uint32 =>
        generateIsosurfaceImpl[Int, IntBuffer](request, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
      case ElementClass.uint64 =>
        generateIsosurfaceImpl[Long, LongBuffer](request, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
    }
  }

  private def generateIsosurfaceImpl[T:ClassTag, B <: Buffer](request: IsosurfaceRequest, dataTypeFunctors: DataTypeFunctors[T, B]): Fox[Array[Float]] = {

    def applyMapping(data: Array[T]): Fox[Array[T]] = {
      request.mapping match {
        case Some(mappingName) =>
          mappingService.applyMapping(DataServiceMappingRequest(request.dataSource, request.dataLayer, mappingName), data, dataTypeFunctors.fromLong)
        case _ =>
          Fox.successful(data)
      }
    }

    def convertData(data: Array[Byte]): Array[T] = {
      val srcBuffer = dataTypeFunctors.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
      srcBuffer.rewind()
      val dstArray = Array.ofDim[T](srcBuffer.remaining())
      dataTypeFunctors.copyDataFn(srcBuffer, dstArray)
      dstArray
    }

    def subVolumeContainsSegmentId[T](data: Array[T], dataDimensions: Vector3I, boundingBox: BoundingBox, segmentId: T): Boolean = {
      for {
        x <- boundingBox.topLeft.x until boundingBox.bottomRight.x
        y <- boundingBox.topLeft.y until boundingBox.bottomRight.y
        z <- boundingBox.topLeft.z until boundingBox.bottomRight.z
      } {
        val voxelOffset = x + y * dataDimensions.x + z * dataDimensions.x * dataDimensions.y
        if (data(voxelOffset) == segmentId) return true
      }
      false
    }

    val cuboid = request.cuboid
    val voxelDimensions = Vector3D(request.voxelDimensions.x, request.voxelDimensions.y, request.voxelDimensions.z)

    val dataRequest = DataServiceDataRequest(request.dataSource, request.dataLayer, request.mapping, cuboid, DataServiceRequestSettings.default, request.voxelDimensions)

    val dataDimensions = Vector3I(
      math.ceil(cuboid.width / voxelDimensions.x).toInt,
      math.ceil(cuboid.height / voxelDimensions.y).toInt,
      math.ceil(cuboid.depth / voxelDimensions.z).toInt)

    val offset = Vector3D(cuboid.topLeft.globalX,cuboid.topLeft.globalY,cuboid.topLeft.globalZ) / Vector3D(cuboid.topLeft.resolution)
    val scale = Vector3D(cuboid.topLeft.resolution) * request.dataSource.scale.toVector

    val typedSegmentId = dataTypeFunctors.fromLong(request.segmentId)

    val vertexBuffer = mutable.ArrayBuffer[Vector3D]()

    for {
      data <- binaryDataService.handleDataRequest(dataRequest)
      typedData = convertData(data)
      mappedData <- applyMapping(typedData)
      mappedSegmentId <- applyMapping(Array(typedSegmentId)).map(_.head)
    } yield {
      for {
        x <- 0 until dataDimensions.x by 32
        y <- 0 until dataDimensions.y by 32
        z <- 0 until dataDimensions.z by 32
      } {
        val boundingBox = BoundingBox(
          Point3D(x, y, z),
          math.min(dataDimensions.x - x, 33),
          math.min(dataDimensions.y - y, 33),
          math.min(dataDimensions.z - z, 33))
        if (subVolumeContainsSegmentId(mappedData, dataDimensions, boundingBox, mappedSegmentId)) {
          MarchingCubes.marchingCubes[T](mappedData, dataDimensions, boundingBox, mappedSegmentId, voxelDimensions, offset, scale, vertexBuffer)
        }
      }
      vertexBuffer.flatMap(_.toList.map(_.toFloat)).toArray
    }
  }
}
