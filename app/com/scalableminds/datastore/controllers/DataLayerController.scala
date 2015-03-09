/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.controllers

import play.api.mvc.Action
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.datastore.DataStorePlugin
import play.api.i18n.Messages
import com.scalableminds.braingames.binary.models.{UnusableDataSource, UsableDataSource}
import play.api.libs.json.Json
import play.api.libs.concurrent.Execution.Implicits._

object DataLayerController extends Controller {

  def create(dataSourceName: String) = Action.async{ implicit request =>
    for {
      dataSource <- DataStorePlugin.dataSourceRepository.findDataSource(dataSourceName) ?~> Messages("dataSource.notFound")
    } yield {
      dataSource match{
        case d: UsableDataSource =>
          val layer = DataStorePlugin.binaryDataService.createUserDataLayer(d.dataSource)
          Ok(Json.toJson(layer))
        case un: UnusableDataSource =>
          BadRequest(Messages("dataSource.notImported"))
      }
    }
  }
}
