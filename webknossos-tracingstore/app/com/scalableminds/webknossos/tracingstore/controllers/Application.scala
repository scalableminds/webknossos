package com.scalableminds.webknossos.tracingstore.controllers

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Failure, Full}
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.CreateNodeSkeletonAction
import play.api.libs.json.Json

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(tracingDataStore: TracingDataStore, redisClient: TracingStoreRedisStore)(
    implicit ec: ExecutionContext)
    extends Controller
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
            afterFossil - before)}, Redis at ${redisClient.authority} ${formatDuration(afterRedis - afterFossil)}).")
        updateAction = CreateNodeSkeletonAction(
          id = 5,
          position = Vec3Int(1, 1, 1),
          rotation = Some(Vec3Double(0, 0, 0)),
          radius = None,
          viewport = None,
          resolution = None,
          bitDepth = None,
          interpolation = None,
          treeId = 0,
          timestamp = 0,
          additionalCoordinates = None,
          actionTracingId = "hi"
        )
        many = (1 to 20000000).toList.map { _ =>
          updateAction
        }
        serializedBox = try {
          logger.info(s"serializing ${many.length} update actions...")
          Full(Json.toJson(many).toString)
        } catch {
          case e: OutOfMemoryError if e.getMessage.contains("String size") => Failure(e.getMessage)
        }
        unpacked <- serializedBox.toFox
        _ = logger.info(
          s"serializing result is ${unpacked.length} chars long, which is ${unpacked.length.toDouble / (Integer.MAX_VALUE >> 1).toDouble} of maximum")
      } yield Ok("Ok")
    }
  }

}
