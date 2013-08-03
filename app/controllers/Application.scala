package controllers

import oxalis.security.Secured
import play.api.mvc.Action
import play.api.mvc._
import play.api._
import play.api.libs.concurrent.Akka
import akka.actor.Props
import braingames.mail.Mailer
import views.html
import models.binary.DataSetDAO
import scala.concurrent.Future
import models.user.UsedAnnotation
import models.basics.Implicits._
import play.api.libs.concurrent.Execution.Implicits._

object Application extends Controller with Secured {
  override val DefaultAccessRole = None
  lazy val app = play.api.Play.current

  lazy val Mailer =
    Akka.system(app).actorFor("/user/mailActor")

  lazy val annotationStore =
    Akka.system(app).actorFor("/user/annotationStore")

  // -- Javascript routing

  def javascriptRoutes = Action {
    implicit request =>
      Ok(
        Routes.javascriptRouter("jsRoutes")(//fill in stuff which should be able to be called from js
          controllers.admin.routes.javascript.NMLIO.upload)).as("text/javascript")
  }

  def index() = UserAwareAction {
    implicit request =>
      request.userOpt match {
        case Some(user) =>
          UsedAnnotation
            .oneBy(user)
            .map(annotationId =>
            Redirect(routes.AnnotationController.trace(annotationId.annotationType, annotationId.identifier)))
            .getOrElse {
            Redirect(routes.UserController.dashboard)
          }
        case _ =>
          Redirect(routes.DataSetController.list)
      }
  }
}