package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Box, Failure, Fox, FoxImplicits, Full, JsonHelper}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.UsableDataSource
import play.api.libs.json.Json

import java.io.FileWriter
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.io.Source

trait DataSourceToDiskWriter extends DataSourceValidation with FoxImplicits {

  private val propertiesFileName = Path.of(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
  private val logFileName = Path.of("datasource-properties-backups.log")

  protected def dataBaseDir: Path

  def updateDataSourceOnDisk(dataSource: UsableDataSource, expectExisting: Boolean, validate: Boolean)(
      implicit ec: ExecutionContext): Fox[Unit] = {
    val organizationDir = dataBaseDir.resolve(dataSource.id.organizationId)
    val dataSourcePath = organizationDir.resolve(dataSource.id.directoryName)

    for {
      _ <- Fox.runIf(validate)(assertValidDataSource(dataSource).toFox)
      propertiesFile = dataSourcePath.resolve(propertiesFileName)
      _ <- Fox.runIf(!expectExisting)(PathUtils.ensureDirectoryBox(dataSourcePath).toFox)
      _ <- Fox.runIf(!expectExisting)(Fox.fromBool(!Files.exists(propertiesFile))) ?~> "dataSource.alreadyPresent"
      _ <- Fox.runIf(expectExisting)(backupPreviousProperties(dataSourcePath).toFox) ?~> "Could not update datasource-properties.json"
      dataSourceWithRelativizedPaths = relativizePathsOfDataSource(dataSourcePath, dataSource)
      _ <- JsonHelper
        .writeToFile(propertiesFile,
                     JsonHelper.removeKeyRecursively(Json.toJson(dataSourceWithRelativizedPaths), Set("resolutions")))
        .toFox ?~> "Could not update datasource-properties.json"
    } yield ()
  }

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
