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

  def deleteOnDisk(
      organizationId: String,
      datasetName: String,
      datasetId: Option[ObjectId], // Is only set for datasets that are already registered in WK. In this case, we query WK using this id for symlink paths and move them.
      isInConversion: Boolean = false,
      reason: Option[String] = None)(implicit ec: ExecutionContext): Fox[Unit] = {

    val dataSourcePath =
      if (isInConversion) dataBaseDir.resolve(organizationId).resolve(forConversionDir).resolve(datasetName)
      else dataBaseDir.resolve(organizationId).resolve(datasetName)

    if (Files.exists(dataSourcePath)) {
      val trashPath: Path = dataBaseDir.resolve(organizationId).resolve(trashDir)
      val targetPath = trashPath.resolve(datasetName)
      PathUtils.ensureDirectory(trashPath)

      logger.info(s"Deleting dataset ${datasetId
        .map(_.toString + " ")
        .getOrElse("")}by moving it from $dataSourcePath to $targetPath ${reason.map(r => s"because $r").getOrElse("...")}")
      deleteWithRetry(dataSourcePath, targetPath)
    } else {
      Fox.successful(logger.info(
        s"Dataset deletion requested for dataset at $dataSourcePath, but it does not exist. Skipping deletion on disk."))
    }
  }

  @tailrec
  private def deleteWithRetry(sourcePath: Path, targetPath: Path, retryCount: Int = 0)(
      implicit ec: ExecutionContext): Fox[Unit] =
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

}
