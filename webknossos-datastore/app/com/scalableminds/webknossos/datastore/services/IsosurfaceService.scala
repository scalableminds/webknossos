package com.scalableminds.webknossos.datastore.services

import java.nio._
import akka.actor.{Actor, ActorRef, ActorSystem, Props}
import akka.pattern.ask
import akka.routing.RoundRobinPool
import akka.util.Timeout
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure}

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.reflect.ClassTag

case class IsosurfaceRequest(dataSource: Option[DataSource],
                             dataLayer: SegmentationLayer,
                             cuboid: Cuboid,
                             segmentId: Long,
                             subsamplingStrides: Vec3Int,
                             scale: Vec3Double,
                             mapping: Option[String] = None,
                             mappingType: Option[String] = None,
                             findNeighbors: Boolean = true)

case class DataTypeFunctors[T, B](
    getTypedBufferFn: ByteBuffer => B,
    copyDataFn: (B, Array[T]) => Unit,
    fromLong: Long => T
)

class IsosurfaceActor(val service: IsosurfaceService, val timeout: FiniteDuration) extends Actor {

  def receive: Receive = {
    case request: IsosurfaceRequest =>
      sender() ! Await.result(service.requestIsosurface(request).futureBox, timeout)
    case _ =>
      sender ! Failure("Unexpected message sent to IsosurfaceActor.")
  }
}

class IsosurfaceService(binaryDataService: BinaryDataService,
                        mappingService: MappingService,
                        actorSystem: ActorSystem,
                        isosurfaceTimeout: FiniteDuration,
                        isosurfaceActorPoolSize: Int)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  implicit val timeout: Timeout = Timeout(isosurfaceTimeout)

  private val actor: ActorRef = actorSystem.actorOf(
    RoundRobinPool(isosurfaceActorPoolSize).props(Props(new IsosurfaceActor(this, timeout.duration))))

  def requestIsosurfaceViaActor(request: IsosurfaceRequest): Fox[(Array[Float], List[Int])] =
    actor.ask(request).mapTo[Box[(Array[Float], List[Int])]].recover {
      case e: Exception => Failure(e.getMessage)
    }

  def requestIsosurface(request: IsosurfaceRequest): Fox[(Array[Float], List[Int])] =
    request.dataLayer.elementClass match {
      case ElementClass.uint8 =>
        generateIsosurfaceImpl[Byte, ByteBuffer](request,
                                                 DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint16 =>
        generateIsosurfaceImpl[Short, ShortBuffer](
          request,
          DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
      case ElementClass.uint32 =>
        generateIsosurfaceImpl[Int, IntBuffer](request,
                                               DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
      case ElementClass.uint64 =>
        generateIsosurfaceImpl[Long, LongBuffer](request,
                                                 DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
    }

  private def generateIsosurfaceImpl[T: ClassTag, B <: Buffer](
      request: IsosurfaceRequest,
      dataTypeFunctors: DataTypeFunctors[T, B]): Fox[(Array[Float], List[Int])] =
    Fox.failure("not implemented")
}
