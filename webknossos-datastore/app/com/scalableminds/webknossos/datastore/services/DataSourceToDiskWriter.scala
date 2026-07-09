package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.Msg
import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.UsableDataSource
import play.api.libs.json.Json

import java.io.FileWriter
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.io.Source

trait DataSourceToDiskWriter extends DataSourceValidation {

  private val propertiesFileName = Path.of(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
  private val logFileName = Path.of("datasource-properties-backups.log")

  def updateDataSourceOnDisk(dataSourcePath: Path, dataSource: UsableDataSource)(implicit
      ec: ExecutionContext
  ): Fox[Unit] =
    for {
      _ <- assertValidDataSource(dataSource).toFox
      propertiesFile = dataSourcePath.resolve(propertiesFileName)
      _ <- backupPreviousProperties(dataSourcePath).toFox ?~> Msg.Dataset.DataSource.updateFileFailed
      dataSourceWithRelativizedPaths = relativizePathsOfDataSource(dataSourcePath, dataSource)
      _ <- JsonHelper
        .writeToFile(
          propertiesFile,
          JsonHelper.removeKeyRecursively(Json.toJson(dataSourceWithRelativizedPaths), Set("resolutions"))
        )
        .toFox ?~> Msg.Dataset.DataSource.updateFileFailed
    } yield ()

  private def relativizePathsOfDataSource(dataSourcePath: Path, dataSource: UsableDataSource): UsableDataSource =
    dataSource.copy(
      dataLayers = dataSource.dataLayers.map(
        _.relativizePaths(UPath.fromLocalPath(dataSourcePath))
      )
    )

  private def backupPreviousProperties(dataSourcePath: Path): Box[Unit] = {
    val propertiesFile = dataSourcePath.resolve(propertiesFileName)
    val previousContentOrEmpty = if (Files.exists(propertiesFile)) {
      val previousContentSource = Source.fromFile(propertiesFile.toString)
      val previousContent = previousContentSource.getLines().mkString("\n")
      previousContentSource.close()
      previousContent
    } else {
      "<empty>"
    }
    val outputForLogfile =
      f"Contents of $propertiesFileName were changed by WEBKNOSSOS at ${Instant.now}. Old content: \n\n$previousContentOrEmpty\n\n"
    val logfilePath = dataSourcePath.resolve(logFileName)
    try {
      val fileWriter = new FileWriter(logfilePath.toString, true)
      try {
        fileWriter.write(outputForLogfile)
        Full(())
      } finally fileWriter.close()
    } catch {
      case e: Exception => Failure(s"Could not back up old contents: ${e.toString}")
    }
  }

}
