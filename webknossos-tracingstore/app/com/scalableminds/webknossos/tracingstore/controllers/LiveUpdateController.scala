package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import javax.inject.Inject
import play.api.libs.streams._
import play.api.mvc._
import akka.actor._
import akka.stream.Materializer
import akka.stream.scaladsl._
import play.api.libs.json.JsValue

import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Promise}

class LiveUpdateController @Inject()(tracingDataStore: TracingDataStore, redisClient: RedisTemporaryStore)(
    implicit ec: ExecutionContext,
    system: ActorSystem,
    mat: Materializer)
    extends Controller {

  val openWebSockets = mutable.Set[Source[String, Promise[Option[String]]]]()

  def liveUpdate(tracingId: String) = WebSocket.accept[String, String] { request =>
    ActorFlow.actorRef(out => MyWebSocketActor.props(out, request.getQueryString("token").get))
  }

  def a = Action { _ =>
    system.actorSelection("/user/*/flowActor") ! Identify()
    Ok
  }

  object MyWebSocketActor {
    def props(out: ActorRef, token: String) = Props(new MyWebSocketActor(out, token))
  }

  class MyWebSocketActor(out: ActorRef, token: String) extends Actor {
    def receive = {
      case msg: String =>
        out ! ("I received your message: " + msg)
      case (key: String, value: JsValue) => if (key != token) out ! value.toString()
    }
  }

}
