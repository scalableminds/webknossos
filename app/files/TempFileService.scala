package files

import cleanup.CleanUpService
import com.scalableminds.util.time.Instant

import java.nio.file.{Files, Path, Paths}
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import net.liftweb.common.Box.tryo
import org.apache.commons.io.FileUtils

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.util.Random

/**
  * Avoiding Java TemporaryFiles because of seeming openJDK regression,
  * see discussion at https://github.com/scalableminds/webknossos/issues/6173
  */
class TempFileService @Inject()(cleanUpService: CleanUpService)(implicit ec: ExecutionContext) extends LazyLogging {

  private val tmpDir: Path = Paths.get(System.getProperty("java.io.tmpdir")).resolve("webknossosTempFiles")

  private val activeTempFiles = scala.collection.mutable.Set[(Path, Instant)]()

  cleanUpService.register("Clean up expired temporary files", 1 hour)(cleanUpExpiredFiles())

  private def ensureParent(): Path =
    Files.createDirectories(tmpDir)

  def create(prefix: String = "tmpFile", lifeTime: FiniteDuration = 2 hours): Path = {
    ensureParent()
    val path = tmpDir.resolve(f"$prefix-${Random.alphanumeric.take(15).mkString("")}")
    logger.info(f"Creating temp file at $path")
    Files.createFile(path)
    activeTempFiles.add((path, Instant.now + lifeTime))
    path
  }

  private def cleanUpExpiredFiles(): Fox[Unit] = {
    val now = Instant.now
    activeTempFiles.foreach {
      case (path, expiryTime) =>
        if (expiryTime < now) {
          tryo(Files.delete(path))
          activeTempFiles.remove((path, expiryTime))
        }
    }
    Fox.successful(())
  }

  def cleanUpAll(): Unit =
    FileUtils.deleteDirectory(tmpDir.toFile)

}
