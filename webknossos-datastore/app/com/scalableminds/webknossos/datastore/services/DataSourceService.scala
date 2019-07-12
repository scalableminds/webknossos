package com.scalableminds.webknossos.datastore.services

import java.io.File
import java.nio.file.{AccessDeniedException, Path, Paths}

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.dataformats.knossos.KnossosDataFormat
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormat
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSource, UnusableDataSource}
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.MappingProvider
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import net.liftweb.util.Helpers.tryo
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

class DataSourceService @Inject()(
    config: DataStoreConfig,
    dataSourceRepository: DataSourceRepository,
    val lifecycle: ApplicationLifecycle,
    @Named("webknossos-datastore") val system: ActorSystem
) extends IntervalScheduler
    with LazyLogging
    with FoxImplicits {

  override protected lazy val enabled: Boolean = config.Braingames.Binary.ChangeHandler.enabled
  protected lazy val tickerInterval: FiniteDuration = config.Braingames.Binary.ChangeHandler.tickerInterval

  private val MaxNumberOfFilesForDataFormatGuessing = 50
  val dataBaseDir = Paths.get(config.Braingames.Binary.baseFolder)

  private val propertiesFileName = Paths.get("datasource-properties.json")

  def tick: Unit = checkInbox()

  def checkInbox(): Fox[Unit] = {
    logger.info(s"Scanning inbox at: $dataBaseDir")
    for {
      _ <- PathUtils.listDirectories(dataBaseDir) match {
        case Full(dirs) =>
          for {
            _ <- Fox.successful(())
            foundInboxSources = dirs.flatMap(teamAwareInboxSources)
            dataSourceString = foundInboxSources.map { ds =>
              s"'${ds.id.team}/${ds.id.name}' (${if (ds.isUsable) "active" else "inactive"})"
            }.mkString(", ")

            _ = logger.info(s"Finished scanning inbox: $dataSourceString")
            _ <- dataSourceRepository.updateDataSources(foundInboxSources)
          } yield ()
        case e =>
          val errorMsg = s"Failed to scan inbox. Error during list directories on '$dataBaseDir': $e"
          logger.error(errorMsg)
          Fox.failure(errorMsg)
      }
    } yield ()
  }

  def handleUpload(id: DataSourceId, dataSetZip: File): Fox[Unit] = {

    def ensureDirectory(dir: Path) =
      try {
        Fox.successful(PathUtils.ensureDirectory(dir))
      } catch {
        case e: AccessDeniedException => Fox.failure("dataSet.import.fileAccessDenied")
      }

    val dataSourceDir = dataBaseDir.resolve(id.team).resolve(id.name)

    logger.info(s"Uploading and unzipping dataset into $dataSourceDir")

    for {
      _ <- ensureDirectory(dataSourceDir)
      unzipResult = ZipIO.unzipToFolder(dataSetZip,
                                        dataSourceDir,
                                        includeHiddenFiles = false,
                                        truncateCommonPrefix = true,
                                        Some(Category.values.map(_.toString).toList))
      _ <- unzipResult match {
        case Full(_) => dataSourceRepository.updateDataSource(dataSourceFromFolder(dataSourceDir, id.team))
        case e => {
          val errorMsg = s"Error unzipping uploaded dataset to $dataSourceDir: $e"
          logger.warn(errorMsg)
          Fox.failure(errorMsg)
        }
      }
    } yield ()
  }

  def exploreDataSource(id: DataSourceId, previous: Option[DataSource]): Box[(DataSource, List[(String, String)])] = {
    val path = dataBaseDir.resolve(id.team).resolve(id.name)
    val report = DataSourceImportReport[Path](dataBaseDir.relativize(path))
    for {
      dataFormat <- guessDataFormat(path)
      result <- dataFormat.exploreDataSource(id, path, previous, report)
    } yield {
      (result, report.messages.toList)
    }
  }

  def exploreMappings(organizationName: String, dataSetName: String, dataLayerName: String): Set[String] =
    MappingProvider.exploreMappings(dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName))

  private def validateDataSource(dataSource: DataSource): Box[Unit] = {
    def Check(expression: Boolean, msg: String): Option[String] = if (!expression) Some(msg) else None

    // Check, that each dimension increases monotonically between different resolutions.
    val resolutionsByX = dataSource.dataLayers.map(_.resolutions.sortBy(_.x))
    val resolutionsByY = dataSource.dataLayers.map(_.resolutions.sortBy(_.y))
    val resolutionsByZ = dataSource.dataLayers.map(_.resolutions.sortBy(_.z))

    val errors = List(
      Check(dataSource.scale.isValid, "DataSource scale is invalid"),
      Check(resolutionsByX == resolutionsByY && resolutionsByX == resolutionsByZ,
            "Scales do not monotonically increase in all dimensions"),
      Check(dataSource.dataLayers.nonEmpty, "DataSource must have at least one dataLayer"),
      Check(dataSource.dataLayers.forall(!_.boundingBox.isEmpty), "DataSource bounding box must not be empty"),
      Check(
        dataSource.dataLayers.forall {
          case layer: SegmentationLayer =>
            layer.largestSegmentId > 0 && layer.largestSegmentId < ElementClass.maxSegmentIdValue(layer.elementClass)
          case _ =>
            true
        },
        "Largest segment ID invalid"
      )
    ).flatten

    if (errors.isEmpty) {
      Full(())
    } else {
      ParamFailure("DataSource is invalid", Json.toJson(errors.map(e => Json.obj("error" -> e))))
    }
  }

  def updateDataSource(dataSource: DataSource): Fox[Unit] =
    for {
      _ <- validateDataSource(dataSource).toFox
      propertiesFile = dataBaseDir.resolve(dataSource.id.team).resolve(dataSource.id.name).resolve(propertiesFileName)
      _ <- JsonHelper.jsonToFile(propertiesFile, dataSource) ?~> "Could not update datasource-properties.json"
      _ <- dataSourceRepository.updateDataSource(dataSource)
    } yield ()

  private def teamAwareInboxSources(path: Path): List[InboxDataSource] = {
    val organization = path.getFileName.toString

    PathUtils.listDirectories(path) match {
      case Full(Nil) =>
        logger.error(s"Failed to read datasets for organization $organization. Empty path: $path")
        Nil
      case Full(dirs) =>
        val dataSources = dirs.map(path => dataSourceFromFolder(path, organization))
        logger.debug(s"Datasets for organization $organization: ${dataSources.map(_.id.name).mkString(", ")}")
        dataSources
      case _ =>
        logger.error(s"Failed to list directories for organization $organization at path $path")
        Nil
    }
  }

  def dataSourceFromFolder(path: Path, organization: String): InboxDataSource = {
    val id = DataSourceId(path.getFileName.toString, organization)
    val propertiesFile = path.resolve(propertiesFileName)

    if (new File(propertiesFile.toString).exists()) {
      JsonHelper.validatedJsonFromFile[DataSource](propertiesFile, path) match {
        case Full(dataSource) =>
          dataSource.copy(id)
        case e =>
          UnusableDataSource(id, s"Error: Invalid json format in $propertiesFile: $e")
      }
    } else {
      UnusableDataSource(id, "Not imported yet.")
    }
  }

  private def guessDataFormat(path: Path): Box[DataSourceImporter] = {
    val dataFormats = List(WKWDataFormat, KnossosDataFormat)

    PathUtils.lazyFileStreamRecursive(path) { files =>
      val fileNames = files.take(MaxNumberOfFilesForDataFormatGuessing).map(_.getFileName.toString).toList
      tryo(dataFormats.maxBy(format => fileNames.count(_.endsWith(format.dataFileExtension))))
    }
  }
}
