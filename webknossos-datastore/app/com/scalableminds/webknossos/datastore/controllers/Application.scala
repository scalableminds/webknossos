package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.mvc.DSTSControllerUtils
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.ApplicationHealthService
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import org.apache.pekko.http.scaladsl.model.HttpHeader.ParsingResult.Ok

import javax.inject.Inject
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}

import scala.concurrent.ExecutionContext

class Application @Inject() (
    redisClient: DataStoreRedisStore,
    applicationHealthService: ApplicationHealthService,
    cc: ControllerComponents
)(implicit ec: ExecutionContext)
    extends AbstractController(cc)
    with DSTSControllerUtils {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Instant.nowFox
        _ <- redisClient.checkHealth
        afterRedis = Instant.now
        _ <- Fox.bool2Fox(applicationHealthService.getRecentProblem().isEmpty) ?~> "Java Internal Errors detected"
        _ = logger.info(
          s"Answering ok for Datastore health check, took ${formatDuration(afterRedis - before)} (Redis at ${redisClient.authority} ${formatDuration(afterRedis - before)})"
        )
      } yield Ok("Ok")
    }
  }

}
