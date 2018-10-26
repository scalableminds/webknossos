package com.scalableminds.webknossos.datastore.services

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.{AskTimeoutException, ask}
import akka.routing.RoundRobinPool
import akka.util.Timeout

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource}
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest, DataServiceRequestSettings}

import net.liftweb.common.{Box,Failure, Full}

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

  def generateIsosurface(request: IsosurfaceRequest): Fox[String] = {
    val dataRequest = DataServiceDataRequest(request.dataSource, request.dataLayer, request.cuboid, DataServiceRequestSettings.default)

    for {
      (data, _) <- binaryDataService.handleDataRequests(List(dataRequest))
    } yield {
      println("foo talking", data.length)
      data.length.toString
    }
  }

  def receive = {
    case request: IsosurfaceRequest =>
      generateIsosurface(request).futureBox.map(sender ! _)
    case _ =>
        sender ! Failure("error in actor")
  }
}

class IsosurfaceService @Inject()(
                                   actorSystem: ActorSystem,
                                   binaryDataServiceHolder: BinaryDataServiceHolder
                                 )(implicit ec: ExecutionContext) extends FoxImplicits {

  val actor = actorSystem.actorOf(RoundRobinPool(1).props(Props(new IsosurfaceActor(binaryDataServiceHolder.binaryDataService))))

  def requestIsosurface(request: IsosurfaceRequest): Fox[String] = {
    implicit val timeout = Timeout(30 seconds)

    actor.ask(request).mapTo[Box[String]].recover {
      case e: Exception => Failure(e.getMessage)
    }
  }
}
