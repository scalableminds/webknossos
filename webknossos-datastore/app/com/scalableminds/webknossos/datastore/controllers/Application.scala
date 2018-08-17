/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.tracings.TracingDataStore
import javax.inject.Inject
import play.api.i18n.MessagesApi
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import play.api.mvc.Action
import play.api.mvc.Results.Ok

class Application @Inject()(tracingDataStore: TracingDataStore,
                            dataStoreConfig: DataStoreConfig,
                            val messagesApi: MessagesApi
                           ) extends Controller {

  def health = Action.async { implicit request =>
    AllowRemoteOrigin {
      for {
        _ <- tracingDataStore.healthClient.checkHealth
      } yield Ok
    }
  }

  def readConfig = Action { implicit request =>
    Ok(Json.toJson(dataStoreConfig.Application.insertInitialData))
  }

}
