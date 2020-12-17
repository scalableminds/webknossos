package com.scalableminds.webknossos.datastore.helpers
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import java.io.File
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext

trait DataSetDeleter extends LazyLogging {
  def dataBaseDir: Path

  def deleteOnDisk(organizationName: String, dataSetName: String, isInConversion: Boolean = false)(
      implicit ec: ExecutionContext): Fox[Unit] = {
    val dataSourcePath =
      if (isInConversion) dataBaseDir.resolve(organizationName).resolve(".forConversion").resolve(dataSetName)
      else dataBaseDir.resolve(organizationName).resolve(dataSetName)
    val trashPath: Path = dataBaseDir.resolve(organizationName).resolve(".trash")
    val targetPath = trashPath.resolve(dataSetName)
    new File(trashPath.toString).mkdirs()

    logger.info(s"Deleting dataset by moving it from $dataSourcePath to $targetPath...")

    try {
      val path = Files.move(
        dataSourcePath,
        targetPath
      )
      if (path == null) {
        throw new Exception("Deleting dataset failed")
      }
      logger.info(s"Successfully moved dataset from $dataSourcePath to $targetPath...")
      Fox.successful(())
    } catch {
      case e: Exception => Fox.failure(s"Deleting dataset failed: ${e.toString}", Full(e))
    }
  }
}
