package com.scalableminds.webknossos.tracingstore.controllers

import akka.http.scaladsl.model.HttpHeader.ParsingResult.Ok
import com.scalableminds.fossildb.proto.fossildbapi.{FossilDBGrpc, GetReply, GetRequest}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import io.grpc.StatusRuntimeException
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

class Application @Inject()(tracingDataStore: TracingDataStore, redisClient: TracingStoreRedisStore)(
    implicit ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Fox.successful(System.currentTimeMillis())
        _ <- tracingDataStore.healthClient.checkHealth
        afterFossil = System.currentTimeMillis()
        _ <- redisClient.checkHealth
        afterRedis = System.currentTimeMillis()
        _ = logger.info(
          s"Answering ok for Tracingstore health check, took ${afterRedis - before} ms (FossilDB ${afterFossil - before} ms, Redis ${afterRedis - afterFossil} ms).")
      } yield Ok("Ok")
    }
  }

  def test: Action[AnyContent] = Action.async {
    val channel =
      NettyChannelBuilder.forAddress("localhost", 7156).usePlaintext.build
    val stub = FossilDBGrpc.stub(channel)
    val replyFuture: Future[GetReply] = stub.get(GetRequest("collection", "key"))
    val transformed: Future[String] = replyFuture.transform {
      case Success(value) =>
        Try("success")
      case Failure(exception) =>
        logger.info(s"got exception: ${exception.getMessage}")
        Try("failure")
    }
    for {
      result <- transformed
    } yield Ok("Ok")

  }

}
