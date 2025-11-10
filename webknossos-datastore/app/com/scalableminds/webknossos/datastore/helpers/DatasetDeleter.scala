package com.scalableminds.webknossos.datastore.helpers
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, Full}
import com.typesafe.scalalogging.LazyLogging

import java.nio.file.{Files, Path}
import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

trait DatasetDeleter extends LazyLogging with DirectoryConstants with FoxImplicits {
  def dataBaseDir: Path

  def deleteOnDisk(datasetId: ObjectId,
                   organizationId: String,
                   datasetName: String,
                   isInConversion: Boolean = false,
                   reason: Option[String] = None)(implicit ec: ExecutionContext): Fox[Unit] = {

    val dataSourcePath =
      if (isInConversion) dataBaseDir.resolve(organizationId).resolve(forConversionDir).resolve(datasetName)
      else dataBaseDir.resolve(organizationId).resolve(datasetName)

    if (Files.exists(dataSourcePath)) {
      val trashPath: Path = dataBaseDir.resolve(organizationId).resolve(trashDir)
      val targetPath = trashPath.resolve(datasetName)
      PathUtils.ensureDirectory(trashPath)

      logger.info(
        s"Deleting dataset $datasetId by moving it from $dataSourcePath to $targetPath ${reason.map(r => s"because $r").getOrElse("...")}")
      deleteWithRetry(dataSourcePath, targetPath)
    } else {
      logger.info(
        s"Dataset deletion requested for dataset $datasetId at $dataSourcePath, but it does not exist. Skipping deletion on disk.")
      Fox.successful(())
    }
  }

  @tailrec
  private def deleteWithRetry(sourcePath: Path, targetPath: Path, retryCount: Int = 0)(
      implicit ec: ExecutionContext): Fox[Unit] =
    if (retryCount > 15) {
      Fox.failure(s"Deleting dataset failed: too many retries.")
    } else {
      try {
        val deduplicatedTargetPath =
          if (retryCount == 0) targetPath else targetPath.resolveSibling(f"${targetPath.getFileName} ($retryCount)")
        Files.move(sourcePath, deduplicatedTargetPath)
        logger.info(s"Successfully moved dataset from $sourcePath to $targetPath.")
        Fox.successful(())
      } catch {
        case _: java.nio.file.FileAlreadyExistsException => deleteWithRetry(sourcePath, targetPath, retryCount + 1)
        case e: Exception                                => Fox.failure(s"Deleting dataset failed: ${e.toString}", Full(e))
      }
    }

}
