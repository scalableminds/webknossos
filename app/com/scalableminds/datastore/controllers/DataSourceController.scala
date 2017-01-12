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
import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.scalableminds.util.tools._
import net.liftweb.common.{Box, Empty, Failure, Full}
import org.apache.commons.io.IOUtils
import play.api.Play
import play.api.data.Form
import play.api.data.Forms.{mapping, nonEmptyText, text, tuple}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
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

  def isProperDataSetName(name: String) = name.matches("[A-Za-z0-9_\\-]*")

  def uploadForm = Form(
    tuple(
      "name" -> nonEmptyText.verifying("dataSet.name.invalid",
        n => isProperDataSetName(n)),
      "team" -> nonEmptyText,
      "scale" -> mapping(
        "scale" -> text.verifying("scale.invalid",
          p => p.matches(Scale.formRx.toString)))(Scale.fromForm)(Scale.toForm)
    )).fill(("", "", Scale.default))

  def upload(token: String) = Action.async(parse.multipartFormData) { implicit request =>
    uploadForm.bindFromRequest(request.body.dataParts).fold(
      hasErrors =
        formWithErrors => Future.successful(JsonBadRequest(formWithErrors.errors.head.message)),
      success = {
        case (name, team, scale) =>
          for {
            oxalisServer <- DataStorePlugin.current.map(_.oxalisServer).toFox ?~> Messages("oxalis.server.unreachable")
            _ <- oxalisServer.validateDSUpload(token, name, team) ?~> Messages("dataSet.name.alreadyTaken")
            zipFile <- request.body.file("zipFile") ?~> Messages("zip.file.notFound")
            settings = DataSourceSettings(None, scale, None)
            upload = DataSourceUpload(name, team, zipFile.ref.file.getAbsolutePath, Some(settings))
            result <- processUpload(upload)
          } yield result
      })
  }

  def processUpload(upload: DataSourceUpload): Fox[Result] = {
    val baseDir = Paths.get(config.getString("braingames.binary.baseFolder")).resolve(upload.team).resolve(upload
                                                                                                             .name)
    logger.warn(s"Uploading dataset into '$baseDir'")
    PathUtils.ensureDirectory(baseDir)
    upload.settings.foreach(DataSourceSettings.writeSettingsToFile(_,
                                                                   DataSourceSettings
                                                                     .settingsFileInFolder(baseDir)))

    for {
      _ <- unzipDataSource(baseDir, upload.filePath).toFox
      dataSource = DataStorePlugin.binaryDataService.dataSourceInbox.handler.dataSourceFromFolder(baseDir, upload.team)
      oxalisServer <- DataStorePlugin.current.map(_.oxalisServer).toFox
      _ = DataSourceDAO.updateDataSource(dataSource)
      _ <- oxalisServer.reportDataSouce(dataSource).toFox
      importingDataSource <- DataStorePlugin.binaryDataService.dataSourceInbox.importDataSource(dataSource)
    } yield {
      importingDataSource.flatMap{ usableDataSource =>
        DataSourceDAO.updateDataSource(usableDataSource)
        oxalisServer.reportDataSouce(usableDataSource).toFox
      }.futureBox.onComplete{ r => Box(r.toOption).flatMap(identity) match {
        case Full(_) =>
          logger.info(s"Completed import of dataset '${dataSource.id}'.")
        case f: Failure =>
          logger.error(s"Failed to import dataset '${dataSource.id}'. Error: $f")
        case Empty =>
          logger.warn(s"Empty result on dataset import of '${dataSource.id}'.")
      }}

      JsonOk(Messages("dataSet.upload.success"))
    }
  }
}
