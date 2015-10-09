/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.controllers

import java.nio.file.Path

import net.liftweb.common.Failure
import play.api.Logger
import com.scalableminds.util.tools._
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.{NotStarted, Finished, InProgress, ProgressState}
import play.api.libs.json.{JsError, JsSuccess, Json, JsValue, JsString}
import com.scalableminds.datastore.services.{DataSourceRepository, BinaryDataService}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Action
import scala.concurrent.Future
import play.api.i18n.Messages
import com.scalableminds.datastore.DataStorePlugin
import com.scalableminds.datastore.models.DataSourceDAO
import com.scalableminds.braingames.binary.models.DataSourceUpload
import java.io.{File, ByteArrayInputStream, FileOutputStream}
import java.nio.file.Paths
import org.apache.commons.io.{FileUtils, IOUtils}
import com.scalableminds.util.io.ZipIO
import play.api.Play
import com.scalableminds.util.io.PathUtils
import com.scalableminds.braingames.binary.models._
import net.liftweb.common.{Box, Empty, Full, Failure}
import java.io._
import play.api.Logger

object DataSourceController extends Controller {

  lazy val config = Play.current.configuration.underlying

  def progressToResult(progress: ProgressState) = progress match {
    case InProgress(p) =>
      JsonOk(Json.obj(
        "operation" -> "import",
        "status" -> "inProgress",
        "progress" -> p))
    case Finished(success) =>
      JsonOk(Json.obj(
        "operation" -> "import",
        "status" -> (if (success) "finished" else "failed"),
        "progress" -> 1))
    case NotStarted =>
      JsonOk(Json.obj(
        "operation" -> "import",
        "status" -> "notStarted",
        "progress" -> 0))
  }

  def importProgress(dataSourceName: String) = Action.async {
    implicit request =>
      for {
        dataSource <- DataStorePlugin.dataSourceRepository.findDataSource(dataSourceName) ?~> Messages("dataSource.notFound")
      } yield {
        progressToResult(DataStorePlugin.binaryDataService.progressForImport(dataSourceName))
      }
  }

  def startImport(dataSourceName: String) = Action.async {
    implicit request =>
      for {
        dataSource <- DataStorePlugin.dataSourceRepository.findDataSource(dataSourceName) ?~> Messages("dataSource.notFound")
        startedImport <- DataStorePlugin.binaryDataService.importDataSource(dataSourceName)
      } yield {
        startedImport.map{ usableDataSource =>
          DataSourceDAO.updateDataSource(usableDataSource)
          DataStorePlugin.binaryDataService.oxalisServer.reportDataSouce(usableDataSource)
        }.futureBox.map{
          case f: Failure =>
            Logger.error("An error occoured: " + f)
        }
        progressToResult(InProgress(0))
      }
  } 

  private def unzipDataSource(baseDir: Path, filePath: String): Box[Unit] = {
    try {
      Logger.warn(s"Unzipping uploaded dataset: $filePath")
      ZipIO.unzipWithFilenames(new File(filePath)).map{
        case (name, in) =>
          val path = baseDir.resolve(Paths.get(name))
          if (path.getParent() != null)
            PathUtils.ensureDirectory(path.getParent())
          val out = new FileOutputStream(new File(path.toString))
          IOUtils.copy(in, out)
          in.close()
          out.close()
        case _ =>
      }
      Full()
    } catch {
      case e: Exception =>
        Logger.warn(s"Error unzipping uploaded dataset at $filePath: ${e.toString}")
        Failure(Messages("zip.file.invalid"))
    }
  }

  def upload() = Action.async(parse.json) {
    implicit request =>
      request.body.validate[DataSourceUpload] match {
        case JsSuccess(upload, _) =>
          val baseDir = Paths.get(config.getString("braingames.binary.baseFolder")).resolve(upload.team).resolve(upload.name)
          PathUtils.ensureDirectory(baseDir)
          upload.settings.map(DataSourceSettings.writeSettingsToFile(_,
            DataSourceSettings.settingsFileInFolder(baseDir)))
          
          (for {
            _ <- unzipDataSource(baseDir, upload.filePath).toFox
            dataSource = DataStorePlugin.binaryDataService.dataSourceInbox.handler.dataSourceFromFolder(baseDir, upload.team)
            importingDataSource <- DataStorePlugin.binaryDataService.dataSourceInbox.importDataSource(dataSource)
            usableDataSource <- importingDataSource
          } yield {
            DataSourceDAO.updateDataSource(usableDataSource)
            DataStorePlugin.binaryDataService.oxalisServer.reportDataSouce(usableDataSource)
            Ok(Json.obj())
          }).futureBox.map {
            case Full(r) => r
            case Empty =>
              BadRequest(Json.obj("error" -> JsString(Messages("error.unknown"))))
            case Failure(error,_,_) =>
              BadRequest(Json.obj("error" -> JsString(error)))
          }

        case e: JsError =>
          Future.successful(BadRequest(Json.obj("error" -> JsString("Json could not be parsed: " + e.toString))))
      }
  }
}
