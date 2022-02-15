package com.scalableminds.webknossos.datastore.controllers

import java.lang.Thread.currentThread
import java.lang.reflect.Field
import java.net.URI
import java.nio.file.spi.FileSystemProvider
import java.util
import java.util.ServiceLoader

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

    val s3Uri = URI.create(s"s3://uk1s3.embassy.ebi.ac.uk")
    logger.info(f"${fileSystemHolder.s3fs}")

    val bucketName = "idr/zarr/v0.1/6001251.zarr"

    val i = ServiceLoader.load(classOf[FileSystemProvider], currentThread().getContextClassLoader).iterator()
    var provider: Option[FileSystemProvider] = None
    while (i.hasNext) {
      val p = i.next()
      if (p.getScheme.equalsIgnoreCase(s3Uri.getScheme)) {
        provider = Some(p)
      }
    }
    val fs = provider.map(_.getFileSystem(s3Uri))

    fs.map { s3fs =>
      val layerPath = s3fs.getPath("/" + bucketName)
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
