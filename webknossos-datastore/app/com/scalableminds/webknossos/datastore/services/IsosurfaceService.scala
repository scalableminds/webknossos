package com.scalableminds.webknossos.datastore.services

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.{AskTimeoutException, ask, pipe}
import akka.routing.RoundRobinPool
import akka.util.Timeout
import com.google.inject.Inject
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest, DataServiceMappingRequest, DataServiceRequestSettings}
import net.liftweb.common.{Box, Failure, Full}
import java.nio._

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.reflect.ClassTag

case class IsosurfaceRequest(
                                     dataSource: DataSource,
                                     dataLayer: SegmentationLayer,
                                     cuboid: Cuboid,
                                     segmentId: Long,
                                     mapping: Option[String] = None
                                    )

class IsosurfaceActor(val dataServicesHolder: DataServicesHolder) extends Actor {

  import context.dispatcher

  val binaryDataService: BinaryDataService = dataServicesHolder.binaryDataService
  val mappingService: MappingService = dataServicesHolder.mappingService

  def generateIsosurface(request: IsosurfaceRequest): Fox[Array[Float]] = {
    request.dataLayer.elementClass match {
      case ElementClass.uint8 =>
        generateIsosurfaceImpl[Byte, ByteBuffer](request, identity, _.get(_))
      case ElementClass.uint16 =>
        generateIsosurfaceImpl[Short, ShortBuffer](request, _.asShortBuffer, _.get(_))
      case ElementClass.uint32 =>
        generateIsosurfaceImpl[Int, IntBuffer](request, _.asIntBuffer, _.get(_))
      case ElementClass.uint64 =>
        generateIsosurfaceImpl[Long, LongBuffer](request, _.asLongBuffer, _.get(_))
    }
  }

  private def generateIsosurfaceImpl[T:ClassTag, B <: Buffer](request: IsosurfaceRequest, typedBufferFn: ByteBuffer => B, copyFn: (B, Array[T]) => Unit): Fox[Array[Float]] = {

    def applyMapping[T:ClassTag](data: Array[T]): Fox[Array[T]] = {
      request.mapping match {
        case Some(mappingName) =>
          mappingService.applyMapping(DataServiceMappingRequest(request.dataSource, request.dataLayer, mappingName), data)
        case _ =>
          Fox.successful(data)
      }
    }

    def convertData(data: Array[Byte]): Array[T] = {
      val srcBuffer = typedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
      srcBuffer.rewind()
      val dstArray = Array.ofDim[T](srcBuffer.remaining())
      copyFn(srcBuffer, dstArray)
      dstArray
    }

    val dataRequest = DataServiceDataRequest(request.dataSource, request.dataLayer, request.mapping, request.cuboid, DataServiceRequestSettings.default)

    val dimensions = Point3D(request.cuboid.width, request.cuboid.height, request.cuboid.depth)
    val boundingBox = BoundingBox(Point3D(0, 0, 0), request.cuboid.width, request.cuboid.height, request.cuboid.depth)

    val offset = Point3D(request.cuboid.topLeft.globalX,request.cuboid.topLeft.globalY,request.cuboid.topLeft.globalZ)
    val scale = request.cuboid.topLeft.resolution

    for {
      data <- binaryDataService.handleDataRequest(dataRequest)
      typedData = convertData(data)
      mappedData <- applyMapping[T](typedData)
      vertices = MarchingCubes.marchingCubes[T](mappedData, dimensions, boundingBox, request.segmentId.toInt, offset, scale)
    } yield {
      vertices
    }
  }

  def receive = {
    case request: IsosurfaceRequest =>
      generateIsosurface(request).futureBox pipeTo sender()
    case _ =>
        sender ! Failure("Unexpected message sent to IsosurfaceActor.")
  }
}

class IsosurfaceService @Inject()(
                                   actorSystem: ActorSystem,
                                   dataServiceHolder: DataServicesHolder
                                 )(implicit ec: ExecutionContext) extends FoxImplicits {

  val actor = actorSystem.actorOf(RoundRobinPool(1).props(Props(new IsosurfaceActor(dataServiceHolder))))

  def requestIsosurface(request: IsosurfaceRequest): Fox[Array[Float]] = {
    implicit val timeout = Timeout(30 seconds)

    actor.ask(request).mapTo[Box[Array[Float]]].recover {
      case e: Exception => Failure(e.getMessage)
    }
  }
}
