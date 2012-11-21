package controllers

import brainflight.security.Secured
import play.api.mvc.Action
import play.api.mvc._
import play.api._

object Application extends Controller with Secured {

  // -- Javascript routing

  def javascriptRoutes = Action { implicit request =>
    Ok(
      Routes.javascriptRouter("jsRoutes")( //fill in stuff which should be able to be called from js
        controllers.routes.javascript.TaskController.finish,
        controllers.admin.routes.javascript.NMLIO.upload,
        controllers.admin.routes.javascript.NMLIO.downloadList)).as("text/javascript")
  }

}

