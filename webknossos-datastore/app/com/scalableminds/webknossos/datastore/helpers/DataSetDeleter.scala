package com.scalableminds.webknossos.datastore.helpers
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full

import java.io.File
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext

trait DataSetDeleter extends LazyLogging with SingleOrganizationAdapter {
  def dataBaseDir: Path
  def singleOrganizationName: Option[String]

  def deleteOnDisk(organizationName: String,
                   dataSetName: String,
                   isInConversion: Boolean = false,
                   reason: Option[String] = None)(implicit ec: ExecutionContext): Fox[Unit] = {
    val dataSourcePath =
      if (isInConversion)
        resolveOrganizationFolderIfExists(dataBaseDir, organizationName).resolve(".forConversion").resolve(dataSetName)
      else resolveOrganizationFolderIfExists(dataBaseDir, organizationName).resolve(dataSetName)
    val trashPath: Path = resolveOrganizationFolderIfExists(dataBaseDir, organizationName).resolve(".trash")
    val targetPath = trashPath.resolve(dataSetName)
    new File(trashPath.toString).mkdirs()

    logger.info(
      s"Deleting dataset by moving it from $dataSourcePath to $targetPath${if (reason.isDefined) s" because ${reason.getOrElse("")}"
      else "..."}")

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
