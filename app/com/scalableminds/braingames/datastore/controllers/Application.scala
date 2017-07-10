/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import javax.inject.Inject

import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import play.api.Configuration
import play.api.i18n.MessagesApi
import play.api.libs.json.Json
import play.api.mvc.Action

class Application @Inject()(
                             store: TracingDataStore,
                             config: Configuration,
                             val messagesApi: MessagesApi
                           ) extends Controller {

  def health = Action {
    implicit request =>
      // This is a simple health endpoint that will always return 200 if the server is correctly running
      // we might do some more advanced checks of the server in the future
      Ok
  }

  def backup = Action {
    implicit request =>
      val start = System.currentTimeMillis()
      logger.info(s"Starting tracing data backup")
      store.backup.map { backupInfo =>
        val duration = System.currentTimeMillis() - start
        logger.info(s"Finished tracing data backup after $duration ms")
        Ok(Json.toJson(backupInfo))
      }
  }
}
