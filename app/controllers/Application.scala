package controllers

import oxalis.security.Secured
import play.api.mvc.Action
import play.api.mvc._
import play.api._
import play.api.libs.concurrent.Akka
import akka.actor.Props
import braingames.mail.Mailer

object Application extends Controller with Secured {
  override val DefaultAccessRole = None
  lazy val app = play.api.Play.current

  lazy val Mailer =
    Akka.system(app).actorFor("/user/mailActor")

  lazy val annotationStore =
    Akka.system(app).actorFor("/user/annotationStore")

  // -- Javascript routing

  def javascriptRoutes = Action { implicit request =>
    Ok(
      Routes.javascriptRouter("jsRoutes")( //fill in stuff which should be able to be called from js
        controllers.admin.routes.javascript.NMLIO.upload)).as("text/javascript")
  }
}