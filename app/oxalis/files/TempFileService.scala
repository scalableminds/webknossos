package oxalis.files

import java.nio.file.{Files, Path, Paths}

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.Box.tryo
import oxalis.cleanup.CleanUpService

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.util.Random

class TempFileService @Inject()(cleanUpService: CleanUpService)(implicit ec: ExecutionContext) extends LazyLogging {

  private val tmpDir: Path = Paths.get(System.getProperty("java.io.tmpdir")).resolve("webKnossosTempFiles")

  private val activeTempFiles = scala.collection.mutable.Set[(Path, Long)]()

  cleanUpService.register("Clean up expired temporary files", 1 hour)(cleanUpExpiredFiles())

  private def ensureParent(): Path =
    Files.createDirectories(tmpDir)

  def create(prefix: String = "tmpFile", lifeTime: FiniteDuration = 2 hours): Path = {
    ensureParent()
    val path = tmpDir.resolve(f"$prefix-${Random.alphanumeric.take(15).mkString("")}")
    Files.createFile(path)
    activeTempFiles.add((path, System.currentTimeMillis() + lifeTime.toMillis))
    path
  }

  def cleanUpExpiredFiles(): Fox[Unit] = {
    val now = System.currentTimeMillis()
    activeTempFiles.foreach {
      case (path, expiryTime) =>
        if (expiryTime < now) {
          tryo(Files.delete(path))
          activeTempFiles.remove((path, expiryTime))
        }
    }
    Fox.successful(())
  }

}
