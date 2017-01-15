package com.scalableminds.datastore.controllers

import javax.inject.Inject

import play.api.i18n.MessagesApi
import play.api.mvc.Action

/**
  * Created by tmbo on 15.01.17.
  */
class Application @Inject()(val messagesApi: MessagesApi) extends Controller {

  def health = Action { implicit request =>
    // This is a simple health endpoint that will always return 200 if the server is correctly running
    // we might do some more advanced checks of the server in the future
    Ok
  }
}