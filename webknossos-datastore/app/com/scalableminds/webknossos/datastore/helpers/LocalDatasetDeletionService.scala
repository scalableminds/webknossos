package com.scalableminds.webknossos.datastore.helpers
import com.google.inject.Inject
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}
import com.typesafe.scalalogging.LazyLogging

import java.nio.file.{Files, Path}
import scala.annotation.tailrec

class LocalDatasetDeletionService @Inject() extends LazyLogging with DirectoryConstants {

  def deleteOnDisk(
      datasetId: ObjectId,
      path: Path,
      organizationId: String,
      directoryName: String,
      reason: Option[String] = None
  ): Box[Unit] =
    if (Files.exists(path)) {
      for {
        orgaDir = path.normalize.getParent
        trashPath: Path = orgaDir.resolve(trashDir)
        targetPath = trashPath.resolve(directoryName)
        _ = PathUtils.ensureDirectory(trashPath)
        _ = logger.info(
          s"Deleting dataset $datasetId by moving it from $path to $targetPath ${reason.map(r => s"because $r").getOrElse("...")}"
        )
        _ <- deleteWithRetry(path, targetPath)
      } yield ()
    } else {
      logger.info(
        s"Dataset deletion requested for dataset $datasetId at $path, but it does not exist. Skipping deletion on disk."
      )
      Full(())
    }

  @tailrec
  private def deleteWithRetry(sourcePath: Path, targetPath: Path, retryCount: Int = 0): Box[Unit] =
    if (retryCount > 15) {
      Failure("Deleting dataset failed: too many retries.")
    } else {
      try {
        val deduplicatedTargetPath =
          if (retryCount == 0) targetPath else targetPath.resolveSibling(f"${targetPath.getFileName} ($retryCount)")
        Files.move(sourcePath, deduplicatedTargetPath)
        logger.info(s"Successfully moved dataset from $sourcePath to $targetPath.")
        Full(())
      } catch {
        case _: java.nio.file.FileAlreadyExistsException => deleteWithRetry(sourcePath, targetPath, retryCount + 1)
        case e: Exception => Failure(s"Deleting dataset failed: ${e.toString}", Full(e), Empty)
      }
    }

}
