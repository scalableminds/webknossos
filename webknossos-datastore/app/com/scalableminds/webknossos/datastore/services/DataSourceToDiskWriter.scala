package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Box, Failure, Fox, FoxImplicits, Full, JsonHelper, ParamFailure}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.{ElementClass, UsableDataSource}
import play.api.libs.json.Json

import java.io.FileWriter
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext
import scala.io.Source

trait DataSourceToDiskWriter extends PathUtils with FoxImplicits {

  private val propertiesFileName = Path.of(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
  private val logFileName = Path.of("datasource-properties-backups.log")

  protected def dataBaseDir: Path

  def updateDataSourceOnDisk(dataSource: UsableDataSource, expectExisting: Boolean, validate: Boolean)(
      implicit ec: ExecutionContext): Fox[Unit] = {
    val organizationDir = dataBaseDir.resolve(dataSource.id.organizationId)
    val dataSourcePath = organizationDir.resolve(dataSource.id.directoryName)

    for {
      _ <- Fox.runIf(validate)(validateDataSource(dataSource, organizationDir).toFox)
      propertiesFile = dataSourcePath.resolve(propertiesFileName)
      _ <- Fox.runIf(!expectExisting)(ensureDirectoryBox(dataSourcePath).toFox)
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

  private def validateDataSource(dataSource: UsableDataSource, organizationDir: Path): Box[Unit] = {
    def Check(expression: Boolean, msg: String): Option[String] = if (!expression) Some(msg) else None

    // Check that when mags are sorted by max dimension, all dimensions are sorted.
    // This means each dimension increases monotonically.
    val magsSorted = dataSource.dataLayers.map(_.resolutions.sortBy(_.maxDim))
    val magsXIsSorted = magsSorted.map(_.map(_.x)) == magsSorted.map(_.map(_.x).sorted)
    val magsYIsSorted = magsSorted.map(_.map(_.y)) == magsSorted.map(_.map(_.y).sorted)
    val magsZIsSorted = magsSorted.map(_.map(_.z)) == magsSorted.map(_.map(_.z).sorted)

    def pathOk(path: UPath): Boolean =
      if (path.isRemote) true
      else {
        val absoluteWithinDataset =
          organizationDir.resolve(dataSource.id.directoryName).resolve(path.toLocalPathUnsafe).toAbsolutePath
        val allowedParent = organizationDir.toAbsolutePath
        if (absoluteWithinDataset.startsWith(allowedParent)) true else false
      }

    val errors = List(
      Check(dataSource.scale.factor.isStrictlyPositive, "DataSource voxel size (scale) is invalid"),
      Check(magsXIsSorted && magsYIsSorted && magsZIsSorted, "Mags do not monotonically increase in all dimensions"),
      Check(dataSource.dataLayers.nonEmpty, "DataSource must have at least one dataLayer"),
      Check(dataSource.dataLayers.forall(!_.boundingBox.isEmpty), "DataSource bounding box must not be empty"),
      Check(
        dataSource.segmentationLayers.forall { layer =>
          ElementClass.segmentationElementClasses.contains(layer.elementClass)
        },
        s"Invalid element class for segmentation layer"
      ),
      Check(
        dataSource.segmentationLayers.forall { layer =>
          ElementClass.largestSegmentIdIsInRange(layer.largestSegmentId, layer.elementClass)
        },
        "Largest segment id exceeds range (must be nonnegative, within element class range, and < 2^53)"
      ),
      Check(
        dataSource.dataLayers.map(_.name).distinct.length == dataSource.dataLayers.length,
        "Layer names must be unique. At least two layers have the same name."
      ),
      Check(
        dataSource.dataLayers.flatMap(_.mags).flatMap(_.path).forall(pathOk),
        "Mags with explicit paths must stay within the organization directory."
      )
    ).flatten

    if (errors.isEmpty) {
      Full(())
    } else {
      ParamFailure("DataSource is invalid", Json.toJson(errors.map(e => Json.obj("error" -> e))))
    }
  }

}
