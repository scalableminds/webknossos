/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.controllers

import play.api.mvc.{Action, Controller}
import braingames.mvc.ExtendedController
import braingames.util.{NotStarted, Finished, InProgress, ProgressState}
import play.api.libs.json.Json
import com.scalableminds.datastore.services.{DataSourceRepository, BinaryDataService}
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.i18n.Messages
import com.scalableminds.datastore.DataStorePlugin
import com.scalableminds.datastore.models.DataSourceDAO

object DataSourceController extends Controller with ExtendedController {
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
        }
        progressToResult(InProgress(0))
      }
  }
}
