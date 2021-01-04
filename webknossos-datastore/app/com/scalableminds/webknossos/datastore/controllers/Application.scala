package com.scalableminds.webknossos.datastore.controllers

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

class Application @Inject()() extends Controller {

  def health: Action[AnyContent] = Action {
    AllowRemoteOrigin {
      Ok("Ok")
    }
  }
}
