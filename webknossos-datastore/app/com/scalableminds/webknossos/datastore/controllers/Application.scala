package com.scalableminds.webknossos.datastore.controllers

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.StorageOptions
import com.google.cloud.storage.contrib.nio.{CloudStorageConfiguration, CloudStorageFileSystem}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.ApplicationHealthService
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import play.api.mvc.{Action, AnyContent}

import java.io.ByteArrayInputStream
import javax.inject.Inject
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

    val storageOptions: StorageOptions = StorageOptions
      .newBuilder()
      .setCredentials(
        ServiceAccountCredentials.fromStream(new ByteArrayInputStream("{\"type\": \"service_account\"}".getBytes())))
      .build();

    val fs =
      CloudStorageFileSystem.forBucket("neuroglancer-fafb-data", CloudStorageConfiguration.DEFAULT, storageOptions)
    val path = fs.getPath("/fafb_v14/fafb_v14_orig/info")
    val bytes = ZipIO.gunzip(Files.readAllBytes(path))
    val text = new String(bytes, StandardCharsets.UTF_8)
    Fox.successful(Ok(s"Hi! ${bytes.length}. $text"))
  }

}
