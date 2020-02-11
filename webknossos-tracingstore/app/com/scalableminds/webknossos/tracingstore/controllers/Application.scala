package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import javax.inject.Inject
import play.api.libs.streams._
import play.api.mvc._
import akka.actor._
import akka.stream.Materializer

import scala.concurrent.ExecutionContext

class Application @Inject()(tracingDataStore: TracingDataStore, redisClient: RedisTemporaryStore)(
    implicit ec: ExecutionContext,
    system: ActorSystem,
    mat: Materializer)
    extends Controller {

  def health = Action.async { implicit request =>
    log {
      AllowRemoteOrigin {
        for {
          _ <- tracingDataStore.healthClient.checkHealth
          _ <- redisClient.checkHealth
        } yield Ok("Ok")
      }
    }
  }

  def liveUpdate = WebSocket.accept[String, String] { request =>
    System.out.println("Connection")
    ActorFlow.actorRef(out => MyWebSocketActor.props(out))
  }
}

object MyWebSocketActor {
  def props(out: ActorRef) = Props(new MyWebSocketActor(out))
}

class MyWebSocketActor(out: ActorRef) extends Actor {
  def receive = {
    case msg: String =>
      out ! ("I received your message: " + msg)
  }
}
