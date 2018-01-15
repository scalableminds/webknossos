/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.binary.api

import java.io.File
import java.nio.file.{Path, Paths}

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.binary.`import`.{DataSourceImportReport, DataSourceImporter}
import com.scalableminds.webknossos.datastore.binary.dataformats.knossos.KnossosDataFormat
import com.scalableminds.webknossos.datastore.binary.dataformats.wkw.WKWDataFormat
import com.scalableminds.webknossos.datastore.binary.helpers.{DataSourceRepository, IntervalScheduler}
import com.scalableminds.webknossos.datastore.binary.models.datasource._
import com.scalableminds.webknossos.datastore.binary.models.datasource.inbox.{InboxDataSource, UnusableDataSource}
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common._
import net.liftweb.util.Helpers.tryo
import play.api.Configuration
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsValue, Json}
import reactivemongo.bson.BSONObjectID

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._

class DataSourceService @Inject()(
                                   config: Configuration,
                                   dataSourceRepository: DataSourceRepository,
                                   val lifecycle: ApplicationLifecycle,
                                   @Named("braingames-binary") val system: ActorSystem
                                 ) extends IntervalScheduler with LazyLogging with FoxImplicits {

  override protected lazy val enabled: Boolean = config.getBoolean("braingames.binary.changeHandler.enabled").getOrElse(true)
  protected lazy val tickerInterval: FiniteDuration = config.getInt("braingames.binary.changeHandler.interval").getOrElse(10).minutes

  private val MaxNumberOfFilesForDataFormatGuessing = 10
  private val dataBaseDir = Paths.get(config.getString("braingames.binary.baseFolder").getOrElse("binaryData"))

  private val propertiesFileName = Paths.get("datasource-properties.json")

  def tick: Unit = checkInbox()

  def checkInbox(): Fox[Unit] = {
    Future {
      logger.info(s"Scanning inbox at: $dataBaseDir")
      PathUtils.listDirectories(dataBaseDir) match {
        case Full(dirs) =>
          val foundInboxSources = dirs.flatMap(teamAwareInboxSources)
          val dataSourceString = foundInboxSources.map { ds =>
            s"'${ds.id.organization}/${ds.id.name}' (${if (ds.isUsable) "active" else "inactive"})"
          }.mkString(", ")
          logger.info(s"Finished scanning inbox: $dataSourceString")
          dataSourceRepository.updateDataSources(foundInboxSources)
          Full(())
        case e =>
          val errorMsg = s"Failed to scan inbox. Error during list directories on '$dataBaseDir': $e"
          logger.error(errorMsg)
          Failure(errorMsg)
      }
    }
  }

  def handleUpload(id: DataSourceId, dataSetZip: File): Box[Unit] = {
    val dataSourceDir = dataBaseDir.resolve(id.organization).resolve(id.name)
    PathUtils.ensureDirectory(dataSourceDir)

    logger.info(s"Uploading and unzipping dataset into $dataSourceDir")

    ZipIO.unzipToFolder(dataSetZip, dataSourceDir, includeHiddenFiles = false, truncateCommonPrefix = true) match {
      case Full(_) =>
        dataSourceRepository.updateDataSource(dataSourceFromFolder(dataSourceDir, id.organization))
        Full(())
      case e =>
        val errorMsg = s"Error unzipping uploaded dataset to $dataSourceDir: $e"
        logger.warn(errorMsg)
        Failure(errorMsg)
    }
  }

  def exploreDataSource(id: DataSourceId, previous: Option[DataSource]): Box[(DataSource, List[(String, String)])] = {
    val path = dataBaseDir.resolve(id.organization).resolve(id.name)
    val report = DataSourceImportReport[Path](dataBaseDir.relativize(path))
    for {
      dataFormat <- guessDataFormat(path)
      result <- dataFormat.exploreDataSource(id, path, previous, report)
    } yield {
      (result, report.messages.toList)
    }
  }

  private def validateDataSource(dataSource: DataSource): Box[Unit] = {
    def Check(expression: Boolean, msg: String): Option[String] = if (!expression) Some(msg) else None

    val errors = List(
      Check(dataSource.scale.isValid, "DataSource scale is invalid"),
      Check(dataSource.dataLayers.nonEmpty, "DataSource must have at least one dataLayer"),
      Check(dataSource.dataLayers.forall(!_.boundingBox.isEmpty), "DataSource bounding box must not be empty"),
      Check(dataSource.dataLayers.forall {
        case layer: SegmentationLayer =>
          layer.largestSegmentId > 0 && layer.largestSegmentId < ElementClass.maxValue(layer.elementClass)
        case _ =>
          true
      }, "Largest segment ID invalid")
    ).flatten

    if (errors.isEmpty) {
      Full(())
    } else {
      ParamFailure("DataSource is invalid", errors.map("error" -> _))
    }
  }

  def updateDataSource(dataSource: DataSource): Box[Unit] = {
    validateDataSource(dataSource).flatMap { _ =>
      val propertiesFile = dataBaseDir.resolve(dataSource.id.organization).resolve(dataSource.id.name).resolve(propertiesFileName)
      JsonHelper.jsonToFile(propertiesFile, dataSource).map { _ =>
        dataSourceRepository.updateDataSource(dataSource)
      }
    }
  }

  private def teamAwareInboxSources(path: Path): List[InboxDataSource] = {
    val team = path.getFileName.toString //TODO

    PathUtils.listDirectories(path) match {
      case Full(Nil) =>
        logger.error(s"Failed to read datasets for team $team. Empty path: $path")
        Nil
      case Full(dirs) =>
        val dataSources = dirs.map(path => dataSourceFromFolder(path, team))
        logger.debug(s"Datasets for team $team: ${dataSources.map(_.id.name).mkString(", ") }")
        dataSources
      case _ =>
        logger.error(s"Failed to list directories for team $team at path $path")
        Nil
    }
  }

  private def dataSourceFromFolder(path: Path, organization: String): InboxDataSource = {
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
    val dataFormats = List(KnossosDataFormat, WKWDataFormat)

    PathUtils.lazyFileStreamRecursive(path) { files =>
      val fileNames = files.take(MaxNumberOfFilesForDataFormatGuessing).map(_.getFileName.toString).toList
      tryo(dataFormats.maxBy(format => fileNames.count(_.endsWith(format.dataFileExtension))))
    }
  }
}
