package com.scalableminds.webknossos.datastore.helpers
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import java.io.File
import java.nio.file.{Files, Path}
import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

trait DatasetDeleter extends LazyLogging with DirectoryConstants {
  def dataBaseDir: Path

  def deleteOnDisk(organizationName: String,
                   datasetName: String,
                   isInConversion: Boolean = false,
                   reason: Option[String] = None)(implicit ec: ExecutionContext): Fox[Unit] = {
    @tailrec
    def deleteWithRetry(sourcePath: Path, targetPath: Path, retryCount: Int = 0): Fox[Unit] =
      try {
        val deduplicatedTargetPath =
          if (retryCount == 0) targetPath else targetPath.resolveSibling(f"${targetPath.getFileName} ($retryCount)")
        val path = Files.move(sourcePath, deduplicatedTargetPath)
        if (path == null) {
          throw new Exception("Deleting dataset failed")
        }
        logger.info(s"Successfully moved dataset from $sourcePath to $targetPath...")
        Fox.successful(())
      } catch {
        case _: java.nio.file.FileAlreadyExistsException => deleteWithRetry(sourcePath, targetPath, retryCount + 1)
        case e: Exception                                => Fox.failure(s"Deleting dataset failed: ${e.toString}", Full(e))
      }

    val dataSourcePath =
      if (isInConversion) dataBaseDir.resolve(organizationName).resolve(forConversionDir).resolve(datasetName)
      else dataBaseDir.resolve(organizationName).resolve(datasetName)

    if (Files.exists(dataSourcePath)) {
      val trashPath: Path = dataBaseDir.resolve(organizationName).resolve(trashDir)
      val targetPath = trashPath.resolve(datasetName)
      new File(trashPath.toString).mkdirs()

      logger.info(
        s"Deleting dataset by moving it from $dataSourcePath to $targetPath${if (reason.isDefined) s" because ${reason.getOrElse("")}"
        else "..."}")
      deleteWithRetry(dataSourcePath, targetPath)
    } else {
      Fox.successful(logger.info(
        s"Dataset deletion requested for dataset at $dataSourcePath, but it does not exist. Skipping deletion on disk."))
    }

  }
}
