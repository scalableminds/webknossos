package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import javax.inject.Inject
import play.api.libs.streams._
import play.api.mvc._
import akka.actor._
import akka.stream.{Materializer, OverflowStrategy}
import akka.stream.scaladsl._
import play.api.libs.json.{JsValue, Json}

import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Promise}

class LiveUpdateController @Inject()(tracingDataStore: TracingDataStore, redisClient: RedisTemporaryStore)(
    implicit ec: ExecutionContext,
    system: ActorSystem,
    mat: Materializer)
    extends Controller {

  val openWebSockets = mutable.Set[SourceQueue[String]]()

  def liveUpdate(tracingId: String) = WebSocket.accept[String, String] { request =>
    ActorFlow.actorRef(out => MyWebSocketActor.props(out, request.getQueryString("token").get))
  }

  def liveUpdateTwo(tracingId: String) = WebSocket.accept[String, String] { request =>
    val in = Sink.ignore
    val out = Source.queue[String](0, OverflowStrategy.fail)
    Flow.fromSinkAndSourceCoupledMat(in, out)(Keep.right).mapMaterializedValue { m =>
      openWebSockets.add(m)
      m
    }
  }

  def a = Action { _ =>
    openWebSockets.foreach(_.offer(Json.toJson(Json.obj("asd" -> "asdasd")).toString()))
    Ok
  }

  object MyWebSocketActor {
    def props(out: ActorRef, token: String) = Props(new MyWebSocketActor(out, token))
  }

  class MyWebSocketActor(out: ActorRef, token: String) extends Actor {
    def receive = {
      case msg: String =>
        out ! (self.path.toSerializationFormat + " received your message: " + msg)
      case (key: String, value: JsValue) => if (key != token) out ! value.toString()
    }
  }

}
