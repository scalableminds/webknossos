package com.scalableminds.webknossos.tracingstore.controllers

import java.io.{BufferedOutputStream, File, FileOutputStream}
import java.nio.file.{Path, Paths}
import java.util.zip.Deflater

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.io.ZipIO.startZip
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.controllers.Controller
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingDataStore
import javax.inject.Inject
import play.api.libs.Files.TemporaryFileCreator
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class Application @Inject()(tracingDataStore: TracingDataStore, redisClient: TracingStoreRedisStore,
                            val temporaryFileCreator: TemporaryFileCreator)(
    implicit ec: ExecutionContext)
    extends Controller {

  def health: Action[AnyContent] = Action.async { implicit request =>
    log() {
      AllowRemoteOrigin {
        for {
          before <- Fox.successful(System.currentTimeMillis())
          _ <- tracingDataStore.healthClient.checkHealth
          afterFossil = System.currentTimeMillis()
          _ <- redisClient.checkHealth
          afterRedis = System.currentTimeMillis()
          _ = logger.info(
            s"Answering ok for Tracingstore health check, took ${afterRedis - before} ms (FossilDB ${afterFossil - before} ms, Redis ${afterRedis - afterFossil} ms).")
        } yield Ok("Ok")
      }
    }
  }

  private val fileList: List[Path] = PathUtils.listFilesRecursive(Paths.get("/home/f/scm/nml/nuclei-volume/data"), maxDepth = 10).openOrThrowException("just testing")

  def zipTest: Action[AnyContent] = Action.async { implicit request =>
    val level = Deflater.DEFAULT_COMPRESSION
    val uncompressedFileSize = 2149540000L // in bytes. 2.15 GB.

    logger.info(s"Starting zip test...")
    val zipped = temporaryFileCreator.create()
    val out = new BufferedOutputStream(new FileOutputStream(new File(zipped.path.toString)))
    val zip = startZip(out)
    zip.stream.setLevel(level)
    val before = System.currentTimeMillis()

    fileList.foreach { path =>
      zip.addFileFromFilePath(path.toString, path)
    }

    zip.close()

    val compressedFileSize = zipped.length()

    val ratio = 100.0 * compressedFileSize.toFloat / uncompressedFileSize.toFloat

    val after = System.currentTimeMillis()
    logger.info(f"Level $level, compressed size $compressedFileSize, ratio $ratio%1.1f %% took ${after - before} ms for ${fileList.length} files.")
    Fox.successful(Ok.sendFile(zipped))
  }

}
