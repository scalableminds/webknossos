/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import java.nio.file.Paths
import javax.inject.Inject

import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import play.api.Configuration
import play.api.i18n.MessagesApi
import play.api.libs.json.Json
import play.api.mvc.Action

class Application @Inject()(
                             tracingDataStore: TracingDataStore,
                             config: Configuration,
                             val messagesApi: MessagesApi
                           ) extends Controller {

  val backupFolder = Paths.get(config.getString("braingames.binary.backupFolder").getOrElse("backup"))

  def health = Action {
    implicit request =>
      // This is a simple health endpoint that will always return 200 if the server is correctly running
      // we might do some more advanced checks of the server in the future
      Ok
  }

  def backup = Action {
    implicit request =>
      val start = System.currentTimeMillis()
      logger.info(s"Starting tracing data backup to '${backupFolder.toAbsolutePath}'")
      tracingDataStore.backup(backupFolder).map { backupInfo =>
        val duration = System.currentTimeMillis() - start
        logger.info(s"Finished tracing data backup after $duration ms")
        Ok(Json.toJson(backupInfo))
      }
  }
}
