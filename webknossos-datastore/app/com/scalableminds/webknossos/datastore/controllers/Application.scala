package com.scalableminds.webknossos.datastore.controllers

import com.google.cloud.storage.contrib.nio.CloudStorageFileSystem
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
        _ <- Fox.bool2Fox(applicationHealthService.getRecentProblem().isEmpty) ?~> "Java Internal Errors detected"
        afterChecks = System.currentTimeMillis()
        _ = logger.info(s"Answering ok for Datastore health check, took ${afterChecks - before} ms")
      } yield Ok("Ok")
    }
  }

  def testGoogleStorage: Action[AnyContent] = Action.async { implicit request =>
    import java.nio.charset.StandardCharsets
    import java.nio.file.Files
    try {
      val fs = CloudStorageFileSystem.forBucket("neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
      try {
        val path = fs.getPath("lolcat.csv")
        val lines = Files.readAllLines(path, StandardCharsets.UTF_8)
      } finally if (fs != null) fs.close()
    }
    Fox.successful(Ok("Hi!"))
  }

}
