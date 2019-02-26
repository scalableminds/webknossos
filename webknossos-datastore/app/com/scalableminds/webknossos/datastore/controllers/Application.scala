package com.scalableminds.webknossos.datastore.controllers

import javax.inject.Inject

import play.api.mvc.Action
import play.api.mvc.Results.Ok

import scala.concurrent.ExecutionContext

class Application @Inject()(implicit ec: ExecutionContext) extends Controller {

  def health = Action { implicit request =>
    AllowRemoteOrigin {
      Ok("Ok")
    }
  }
}
