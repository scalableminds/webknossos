package com.scalableminds.webknossos.tracingstore.files

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.tracingstore.cleanup.CleanUpService
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import org.apache.commons.io.FileUtils

import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.util.Random

/**
  * Avoiding Java TemporaryFiles because of seeming openJDK regression,
  * see discussion at https://github.com/scalableminds/webknossos/issues/6173
  */
trait TempFileService extends LazyLogging {
  protected def cleanUpService: CleanUpService
  implicit protected def ec: ExecutionContext
  protected def moduleName: String

  private val tmpDir: Path = Path.of(System.getProperty("java.io.tmpdir")).resolve(s"$moduleName-tempfiles")

  private val activeTempFiles = scala.collection.mutable.Set[(Path, Instant)]()

  cleanUpService.register(s"Deleting temporary files at $tmpDir", 1 hour)(cleanUpExpiredFiles())

  private def ensureParent(): Path =
    Files.createDirectories(tmpDir)

  def create(prefix: String = "tmpFile", lifeTime: FiniteDuration = 2 hours, isDirectory: Boolean = false): Path = {
    ensureParent()
    val path = tmpDir.resolve(f"$prefix-${Random.alphanumeric.take(15).mkString("")}")
    logger.debug(f"Creating temp ${if (isDirectory) "dir" else "file"} at $path")
    if (isDirectory)
      Files.createDirectory(path)
    else
      Files.createFile(path)
    activeTempFiles.add((path, Instant.now + lifeTime))
    path
  }

  def createDirectory(prefix: String = "tmpDir", lifeTime: FiniteDuration = 2 hours): Path =
    create(prefix, lifeTime, isDirectory = true)

  private def cleanUpExpiredFiles(): Fox[Unit] = {
    val now = Instant.now
    activeTempFiles.foreach {
      case (path, expiryTime) =>
        if (expiryTime < now) {
          if (Files.isDirectory(path))
            tryo(FileUtils.deleteDirectory(path.toFile))
          else
            tryo(Files.delete(path))
          activeTempFiles.remove((path, expiryTime))
        }
    }
    Fox.successful(())
  }

  def cleanUpAll(): Unit =
    FileUtils.deleteDirectory(tmpDir.toFile)

}
