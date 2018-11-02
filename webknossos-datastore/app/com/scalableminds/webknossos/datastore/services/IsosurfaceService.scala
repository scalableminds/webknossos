package com.scalableminds.webknossos.datastore.services

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.{AskTimeoutException, ask, pipe}
import akka.routing.RoundRobinPool
import akka.util.Timeout

import com.google.inject.Inject

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, ElementClass}
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest, DataServiceRequestSettings}

import net.liftweb.common.{Box,Failure, Full}

import java.nio.{ByteBuffer, ByteOrder, IntBuffer, LongBuffer, ShortBuffer}

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

case class IsosurfaceRequest(
                                     dataSource: DataSource,
                                     dataLayer: DataLayer,
                                     cuboid: Cuboid,
                                     segmentId: Long,
                                     mapping: Option[String] = None
                                    )

class IsosurfaceActor(val binaryDataService: BinaryDataService) extends Actor {

  import context.dispatcher

  def generateIsosurface(request: IsosurfaceRequest): Fox[Array[Float]] = {
    val dataRequest = DataServiceDataRequest(request.dataSource, request.dataLayer, request.mapping, request.cuboid, DataServiceRequestSettings.default)

    val dimensions = Point3D(request.cuboid.width, request.cuboid.height, request.cuboid.depth)
    val boundingBox = BoundingBox(Point3D(0, 0, 0), request.cuboid.width, request.cuboid.height, request.cuboid.depth)

    val offset = Point3D(request.cuboid.topLeft.globalX,request.cuboid.topLeft.globalY,request.cuboid.topLeft.globalZ)
    val scale = request.cuboid.topLeft.resolution

    for {
      data <- binaryDataService.handleDataRequest(dataRequest)
      vertices = request.dataLayer.elementClass match {
        //case ElementClass.uint16 =>
        // ...
        case ElementClass.uint32 =>
          MarchingCubes.marchingCubesInt(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer, dimensions, boundingBox, request.segmentId.toInt, offset, scale)
        //case ElementClass.uint64 =>
        // ...
        case _ =>
          Array.empty[Float]
      }
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
                                   binaryDataServiceHolder: BinaryDataServiceHolder
                                 )(implicit ec: ExecutionContext) extends FoxImplicits {

  val actor = actorSystem.actorOf(RoundRobinPool(1).props(Props(new IsosurfaceActor(binaryDataServiceHolder.binaryDataService))))

  def requestIsosurface(request: IsosurfaceRequest): Fox[Array[Float]] = {
    implicit val timeout = Timeout(30 seconds)

    actor.ask(request).mapTo[Box[Array[Float]]].recover {
      case e: Exception => Failure(e.getMessage)
    }
  }
}
