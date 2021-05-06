package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(tracingDataStore: TracingDataStore, redisClient: RedisTemporaryStore)(
    implicit ec: ExecutionContext)
    extends Controller {

  def health: Action[AnyContent] = Action.async { implicit request =>
    log {
      AllowRemoteOrigin {
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
  }

}
