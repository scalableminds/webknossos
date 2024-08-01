package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.ApplicationHealthService
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(redisClient: DataStoreRedisStore, applicationHealthService: ApplicationHealthService)(
    implicit ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Fox.successful(System.currentTimeMillis())
        _ <- redisClient.checkHealth
        afterRedis = System.currentTimeMillis()
        _ <- Fox.bool2Fox(applicationHealthService.getRecentProblem().isEmpty) ?~> "Java Internal Errors detected"
        _ = logger.info(
          s"Answering ok for Datastore health check, took ${afterRedis - before} ms (Redis at ${redisClient.authority} ${afterRedis - before} ms)")
      } yield Ok("Ok")
    }
  }

}
