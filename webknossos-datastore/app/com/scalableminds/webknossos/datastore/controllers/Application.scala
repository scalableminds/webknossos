/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.webknossos.datastore.tracings.TracingDataStore
import javax.inject.Inject
import play.api.i18n.MessagesApi
import scala.concurrent.ExecutionContext.Implicits.global
import play.api.mvc.Action

class Application @Inject()(tracingDataStore: TracingDataStore, val messagesApi: MessagesApi) extends Controller {

  def health = Action.async { implicit request =>
    for {
      _ <- tracingDataStore.healthClient.checkHealth
    } yield Ok
  }

}
