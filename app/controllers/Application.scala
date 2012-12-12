package controllers

import brainflight.security.Secured
import play.api.mvc.Action
import play.api.mvc._
import play.api._
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.Props
import brainflight.mail.Mailer

object Application extends Controller with Secured {

  val Mailer = Akka.system.actorOf(Props[Mailer], name = "mailActor")

  // -- Javascript routing

  def javascriptRoutes = Action { implicit request =>
    Ok(
      Routes.javascriptRouter("jsRoutes")( //fill in stuff which should be able to be called from js
        controllers.admin.routes.javascript.LevelCreator.deleteAsset,
        controllers.admin.routes.javascript.LevelCreator.listAssets,
        controllers.admin.routes.javascript.LevelCreator.retrieveAsset,
        controllers.admin.routes.javascript.NMLIO.upload,
        controllers.routes.javascript.BinaryData.arbitraryViaAjax
      )).as("text/javascript")
  }

}

