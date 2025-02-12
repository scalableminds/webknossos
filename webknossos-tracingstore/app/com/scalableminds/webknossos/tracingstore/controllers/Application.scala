package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.mvc.{DSTSControllerUtils, Formatter}
import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore

import javax.inject.Inject
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}

import scala.concurrent.ExecutionContext

class Application @Inject() (
    tracingDataStore: TracingDataStore,
    redisClient: TracingStoreRedisStore,
    cc: ControllerComponents
)(implicit ec: ExecutionContext)
    extends AbstractController(cc)
    with DSTSControllerUtils
    with Formatter {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Instant.nowFox
        _ <- tracingDataStore.healthClient.checkHealth()
        afterFossil = Instant.now
        _ <- redisClient.checkHealth
        afterRedis = Instant.now
        _ = logger.info(
          s"Answering ok for Tracingstore health check, took ${formatDuration(afterRedis - before)} (FossilDB at ${tracingDataStore.healthClient.authority} ${formatDuration(
              afterFossil - before
            )}, Redis at ${redisClient.authority} ${formatDuration(afterRedis - afterFossil)})."
        )
      } yield Ok("Ok")
    }
  }

}
