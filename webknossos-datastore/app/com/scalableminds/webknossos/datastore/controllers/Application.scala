package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWBucketProvider
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(redisClient: DataStoreRedisStore, wkwBucketProvider: WKWBucketProvider)(
    implicit ec: ExecutionContext)
    extends Controller {

  override def allowRemoteOrigin: Boolean = true

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      for {
        before <- Fox.successful(System.currentTimeMillis())
        _ <- redisClient.checkHealth
        _ <- Fox.bool2Fox(wkwBucketProvider.isHealthy)
        afterRedis = System.currentTimeMillis()
        _ = logger.info(s"Answering ok for Datastore health check, took ${afterRedis - before} ms")
      } yield Ok("Ok")
    }
  }

}
