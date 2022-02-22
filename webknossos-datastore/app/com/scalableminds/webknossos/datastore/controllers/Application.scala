package com.scalableminds.webknossos.datastore.controllers

import java.lang.reflect.Field
import java.nio.file.spi.FileSystemProvider

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(redisClient: DataStoreRedisStore /*, fileSystemHolder: FileSystemHolder*/ )(
    implicit ec: ExecutionContext)
    extends Controller {

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      AllowRemoteOrigin {
        for {
          before <- Fox.successful(System.currentTimeMillis())
          _ <- redisClient.checkHealth
          afterRedis = System.currentTimeMillis()
          _ = logger.info(s"Answering ok for Datastore health check, took ${afterRedis - before} ms")
        } yield Ok("Ok")
      }
    }
  }

  def getField(name: String): Field = {
    val field = classOf[FileSystemProvider].getDeclaredField(name)
    field.setAccessible(true)
    field
  }

}
