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
                              service: BinaryDataService,
                              dataSource: DataSource,
                              dataLayer: DataLayer,
                              cuboid: Cuboid,
                              segmentId: Long,
                              mapping: Option[String] = None
                            )

class IsosurfaceService @Inject()(
                                   actorSystem: ActorSystem,
                                   binaryDataServiceHolder: BinaryDataServiceHolder
                                 )(implicit ec: ExecutionContext) extends FoxImplicits {

  val actor = actorSystem.actorOf(RoundRobinPool(1).props(Props[IsosurfaceActor]))

  def requestIsosurface(request: IsosurfaceRequest): Fox[String] = {
    implicit val timeout = Timeout(30 seconds)
    actor.ask(request).mapTo[Box[String]].recover {
      case e: Exception => Failure(e.getMessage)
    }
  }
}

class IsosurfaceActor extends Actor {

  def foo(request: IsosurfaceRequest): Fox[String] = {
    val dataRequest = DataServiceDataRequest(request.dataSource, request.dataLayer, request.cuboid, DataServiceRequestSettings.default)

    for {
      (data, _) <- request.service.handleDataRequests(List(dataRequest))
    } yield {
      println("foo talking", data.length)
      data.length.toString
    }
  }

  def receive = {
    case request: IsosurfaceRequest => {
      sender ! Await.result(foo(request).futureBox , 30 seconds)
    }
    case _ =>
      sender ! Failure("error in actor")
  }
}
