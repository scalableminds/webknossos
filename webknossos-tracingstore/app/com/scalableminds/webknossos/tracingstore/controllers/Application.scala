package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import javax.inject.Inject

import scala.concurrent.ExecutionContext

class Application @Inject()(tracingDataStore: TracingDataStore, redisClient: RedisTemporaryStore)(
    implicit ec: ExecutionContext)
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

}
