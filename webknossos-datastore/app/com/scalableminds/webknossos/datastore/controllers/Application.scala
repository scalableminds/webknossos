package com.scalableminds.webknossos.datastore.controllers

import com.google.auth.oauth2.ServiceAccountCredentials
import com.google.cloud.storage.StorageOptions
import com.google.cloud.storage.contrib.nio.{CloudStorageConfiguration, CloudStorageFileSystem}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.ApplicationHealthService
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import net.liftweb.util.Helpers.tryo
import play.api.mvc.{Action, AnyContent}

import java.io.FileInputStream
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

    val useCredentials = true
    val bucket = "zarr-example-datasets"
    val pathStr = "6001251.zarr/0/.zarray"
    // val bucket = "neuroglancer-fafb-data"
    // val pathStr = "fafb_v14/fafb_v14_orig/info"

    val storageOptions =
      if (useCredentials)
        StorageOptions
          .newBuilder()
          .setCredentials(ServiceAccountCredentials.fromStream(new FileInputStream("google-service-credentials.json")))
          .build()
      else StorageOptions.newBuilder().build()

    val fs =
      CloudStorageFileSystem.forBucket(bucket, CloudStorageConfiguration.DEFAULT, storageOptions)
    val path = fs.getPath("6001251.zarr").resolve("0/.zarray")
    val bytesRaw = Files.readAllBytes(path)
    val bytes = tryo(ZipIO.gunzip(bytesRaw)).toOption.getOrElse(bytesRaw)
    val text = new String(bytes, StandardCharsets.UTF_8)
    Fox.successful(Ok(s"Received ${bytes.length} bytes: $text"))
  }

}
