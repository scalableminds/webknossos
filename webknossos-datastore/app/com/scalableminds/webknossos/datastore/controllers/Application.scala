package com.scalableminds.webknossos.datastore.controllers

import java.lang.reflect.Field
import java.nio.file.{Files, Path}
import java.nio.file.spi.FileSystemProvider
import java.util

import com.bc.zarr.ZarrArray
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.zarr.FileSystemHolder
import com.scalableminds.webknossos.datastore.storage.DataStoreRedisStore
import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(redisClient: DataStoreRedisStore, fileSystemHolder: FileSystemHolder)(implicit ec: ExecutionContext) extends Controller {

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

  def testS3: Action[AnyContent] = Action { implicit request =>
    val existingProviders: util.List[FileSystemProvider] = FileSystemProvider.installedProviders

    logger.info(f"${fileSystemHolder.s3fs}")

    val path = "demodata/6001251.zarr"



    fileSystemHolder.s3fs.map { s3fs =>
      val layerPath: Path = s3fs.getPath("/" + path + "/0/")
      try {
        logger.info(s"${Files.list(s3fs.getPath("/webknossos-zarr/demodata/6001251.zarr"))}")
      } catch {
        case e: Exception => logger.info("/webknossos-zarr/demodata/6001251.zarr errored:", e)
      }

      ZarrArray.open(layerPath)
    }



    /*val scl = classOf[ClassLoader].getDeclaredField("scl")
    scl.setAccessible(true)

    val prevClassLoader = getSystemClassLoader
    scl.set(null, currentThread().getContextClassLoader)

    val installedProviders = FileSystemProvider.installedProviders().asScala

    val newClassLoaderProviders =
      installedProviders
        .map(
          p => p.getScheme -> p
        )
        .toMap


    getField("installedProviders").set(
      null,
      newClassLoaderProviders.values
        .asJava
        .asInstanceOf[util.List[FileSystemProvider]])

    scl.set(null, prevClassLoader)

    logger.info(s"INSTALLED: ${FileSystemProvider
      .installedProviders()
      .asScala}")
*/
    Ok
  }

}
