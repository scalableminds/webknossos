package com.scalableminds.webknossos.datastore.services

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.{AskTimeoutException, ask, pipe}
import akka.routing.RoundRobinPool
import akka.util.Timeout
import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest, DataServiceMappingRequest, DataServiceRequestSettings}
import net.liftweb.common.{Box, Failure}
import java.nio._

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.reflect.ClassTag

case class IsosurfaceRequest(
                              dataSource: DataSource,
                              dataLayer: SegmentationLayer,
                              cuboid: Cuboid,
                              segmentId: Long,
                              voxelDimensions: Point3D,
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

    val dataRequest = DataServiceDataRequest(request.dataSource, request.dataLayer, request.mapping, request.cuboid, DataServiceRequestSettings.default)

    val dimensions = Point3D(request.cuboid.width, request.cuboid.height, request.cuboid.depth)
    val boundingBox = BoundingBox(Point3D(0, 0, 0), request.cuboid.width, request.cuboid.height, request.cuboid.depth)

    val offset = Vector3D(request.cuboid.topLeft.globalX,request.cuboid.topLeft.globalY,request.cuboid.topLeft.globalZ) / Vector3D(request.cuboid.topLeft.resolution)
    val scale = Vector3D(request.cuboid.topLeft.resolution) * request.dataSource.scale.toVector

    val typedSegmentId = dataTypeFunctors.fromLong(request.segmentId)

    for {
      data <- binaryDataService.handleDataRequest(dataRequest)
      typedData = convertData(data)
      mappedData <- applyMapping(typedData)
      mappedSegmentId <- applyMapping(Array(typedSegmentId)).map(_.head)
      vertices = MarchingCubes.marchingCubes[T](mappedData, dimensions, boundingBox, mappedSegmentId, request.voxelDimensions, offset, scale)
    } yield {
      vertices
    }
  }
}
