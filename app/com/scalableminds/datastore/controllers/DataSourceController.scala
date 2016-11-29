/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.controllers

import java.io.{File, FileOutputStream}
import java.nio.file.{Path, Paths}
import javax.inject.Inject

import com.scalableminds.braingames.binary.models.{DataSourceUpload, _}
import com.scalableminds.braingames.binary.watcher.DirectoryWatcherActor
import com.scalableminds.datastore.DataStorePlugin
import com.scalableminds.datastore.models.DataSourceDAO
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools.{Finished, InProgress, NotStarted, ProgressState}
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.apache.commons.io.IOUtils
import play.api.Play
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsError, JsString, JsSuccess, Json}
import play.api.mvc.{Action, Result}

import scala.concurrent.Future

class DataSourceController @Inject()(val messagesApi: MessagesApi) extends Controller {

  lazy val config = Play.current.configuration.underlying

  def progressToResult(progress: ProgressState): Result = progress match {
    case InProgress(p) =>
      JsonOk(Json.obj(
                       "operation" -> "import",
                       "status" -> "inProgress",
                       "progress" -> p))
    case Finished(Full(_)) | Finished(Empty) =>
      JsonOk(Json.obj(
                       "operation" -> "import",
                       "status" -> "finished",
                       "progress" -> 1), Seq(jsonSuccess -> Messages("dataSet.import.success")))
    case Finished(Failure(msg, _, _)) =>
      JsonOk(Json.obj(
                       "operation" -> "import",
                       "status" -> "failed",
                       "progress" -> 1), Seq(jsonError -> msg))
    case NotStarted =>
      JsonOk(Json.obj(
                       "operation" -> "import",
                       "status" -> "notStarted",
                       "progress" -> 0))
  }

  def importProgress(dataSourceName: String) = Action.async {
    implicit request =>
      for {
        dataSource <- DataStorePlugin.dataSourceRepository
          .findDataSource(dataSourceName) ?~> Messages("dataSource.notFound")
      } yield {
        progressToResult(DataStorePlugin.binaryDataService.progressForImport(dataSourceName))
      }
  }

  def triggerInboxCheck() = Action.async {
    implicit request =>
      for {
        watcher <- DataStorePlugin.binaryDataService.repositoryWatcher ?~> Messages("dataSource.directoryWatcher.dead")
        _ = watcher ! DirectoryWatcherActor.CheckDirectoryOnce
      } yield Ok(Json.obj())
  }

  def startImport(dataSourceName: String) = Action.async {
    implicit request =>
      for {
        dataSource <- DataStorePlugin.dataSourceRepository
          .findDataSource(dataSourceName) ?~> Messages("dataSource.notFound")
        startedImport <- DataStorePlugin.binaryDataService.importDataSource(dataSourceName)
      } yield {
        startedImport.map { usableDataSource =>
          DataSourceDAO.updateDataSource(usableDataSource)
          DataStorePlugin.current.map(_.oxalisServer.reportDataSouce(usableDataSource))
        }.futureBox.foreach {
          case f: Failure =>
            logger.error("An error occoured: " + f)
          case _ =>
            logger.info(s"Start import completed for $dataSourceName")
        }
        progressToResult(InProgress(0))
      }
  }

  private def unzipDataSource(baseDir: Path, filePath: String): Box[Boolean] = {
    try {
      logger.warn(s"Unzipping uploaded dataset: $filePath")
      ZipIO.withUnziped(new File(filePath), includeHiddenFiles = false){ (name, in) =>
        val path = baseDir.resolve(Paths.get(name))
        if (path.getParent != null)
          PathUtils.ensureDirectory(path.getParent)
        val out = new FileOutputStream(new File(path.toString))
        IOUtils.copy(in, out)
        out.close()
      }
      Full(true)
    } catch {
      case e: Exception =>
        logger.warn(s"Error unzipping uploaded dataset at $filePath: ${e.toString }")
        Failure(Messages("zip.file.invalid"))
    }
  }

  def upload() = Action.async(parse.json) {
    implicit request =>
      logger.warn("Dataset upload to store called.")
      request.body.validate[DataSourceUpload] match {
        case JsSuccess(upload, _) =>
          val baseDir = Paths.get(config.getString("braingames.binary.baseFolder")).resolve(upload.team).resolve(upload
                                                                                                                   .name)
          logger.warn(s"Uploading dataset into '$baseDir'")
          PathUtils.ensureDirectory(baseDir)
          upload.settings.foreach(DataSourceSettings.writeSettingsToFile(_,
                                                                         DataSourceSettings
                                                                           .settingsFileInFolder(baseDir)))

          (for {
            _ <- unzipDataSource(baseDir, upload.filePath).toFox
            dataSource = DataStorePlugin.binaryDataService.dataSourceInbox.handler.dataSourceFromFolder(baseDir,
                                                                                                        upload.team)
            oxalisServer <- DataStorePlugin.current.map(_.oxalisServer).toFox
            _ <- oxalisServer.reportDataSouce(dataSource).toFox
            importingDataSource <- DataStorePlugin.binaryDataService.dataSourceInbox.importDataSource(dataSource)
            usableDataSource <- importingDataSource
            _ = DataSourceDAO.updateDataSource(usableDataSource)
            _ <- oxalisServer.reportDataSouce(usableDataSource).toFox
          } yield Ok(Json.obj())
            ).futureBox.map {
            case Full(r) => r
            case Empty =>
              BadRequest(Json.obj("error" -> Messages("error.unknown")))
            case Failure(error, _, _) =>
              BadRequest(Json.obj("error" -> error))
          }

        case e: JsError =>
          Future.successful(BadRequest(Json.obj("error" -> JsString("Json could not be parsed: " + e.toString))))
      }
  }
}
