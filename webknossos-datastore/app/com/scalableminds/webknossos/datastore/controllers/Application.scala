package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.time.{DurationFormatting, Instant}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.ApplicationHealthService
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(redisClient: DataStoreRedisStore, applicationHealthService: ApplicationHealthService)(
    implicit ec: ExecutionContext)
    extends Controller
    with DurationFormatting {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Instant.nowFox
        _ <- redisClient.checkHealth
        afterRedis = Instant.now
        _ <- Fox.bool2Fox(applicationHealthService.getRecentProblem().isEmpty) ?~> "Java Internal Errors detected"
        _ = logger.info(
          s"Answering ok for Datastore health check, took ${formatDuration(afterRedis - before)} (Redis at ${redisClient.authority} ${formatDuration(
            afterRedis - before)})")
      } yield Ok("Ok")
    }
  }

}
