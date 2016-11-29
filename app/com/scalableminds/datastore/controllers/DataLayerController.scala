/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.controllers

import java.io.File
import javax.inject.Inject

import com.scalableminds.braingames.binary.models.{DataSourceLike, UnusableDataSource, UsableDataSource}
import com.scalableminds.datastore.DataStorePlugin
import com.scalableminds.util.tools.Fox
import play.api.Logger
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.mvc.Action

class DataLayerController @Inject()(val messagesApi: MessagesApi) extends Controller {

  def create(dataSourceName: String) = Action.async { implicit request =>
    def createLayer(dataSource: DataSourceLike, initialData: Option[File]) = {
      dataSource match {
        case d: UsableDataSource =>
          DataStorePlugin.binaryDataService.createUserDataLayer(d.dataSource, initialData)
        case _: UnusableDataSource =>
          Fox.failure("dataStore.dataSource.notImported")
      }
    }

    for {
      dataSource <- DataStorePlugin.dataSourceRepository.findDataSource(dataSourceName) ?~> Messages("dataSource.notFound")
      initialData = request.body.asRaw.map(_.asFile)
      result <- createLayer(dataSource, initialData)
    } yield {
      Ok(Json.toJson(result))
    }
  }
}
