/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import javax.inject.Inject

import play.api.i18n.MessagesApi
import play.api.mvc.Action

class Application @Inject()(val messagesApi: MessagesApi) extends Controller {

  def health = Action {
    implicit request =>
      // This is a simple health endpoint that will always return 200 if the server is correctly running
      // we might do some more advanced checks of the server in the future
      Ok
  }
}
