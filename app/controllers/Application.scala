package controllers

import oxalis.security.Secured
import play.api.mvc.Action
import play.api._
import play.api.libs.concurrent.Akka
import scala.concurrent.Future
import models.user.{UsedAnnotationDAO, UsedAnnotation}
import models.basics.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.templates.Html
import net.liftweb.common.Full

object Application extends Controller with Secured {
  lazy val app = play.api.Play.current

  lazy val version = scala.io.Source.fromFile("version").mkString.trim

  lazy val Mailer =
    Akka.system(app).actorFor("/user/mailActor")

  lazy val annotationStore =
    Akka.system(app).actorFor("/user/annotationStore")

  // -- Javascript routing

  def javascriptRoutes = Action { implicit request =>
    Ok(
      Routes.javascriptRouter("jsRoutes")(//fill in stuff which should be able to be called from js
        controllers.admin.routes.javascript.NMLIO.upload,
        controllers.routes.javascript.AnnotationController.annotationsForTask,
        controllers.admin.routes.javascript.TaskAdministration.tasksForProject, 
        controllers.admin.routes.javascript.TaskAdministration.edit,
        controllers.routes.javascript.AnnotationController.trace,
        controllers.routes.javascript.AnnotationController.finish,
        controllers.routes.javascript.AnnotationController.nameExplorativeAnnotation,
        controllers.routes.javascript.AnnotationController.download,
        controllers.admin.routes.javascript.NMLIO.taskDownload,
        controllers.admin.routes.javascript.NMLIO.projectDownload,
        controllers.admin.routes.javascript.TrainingsTaskAdministration.create,
        controllers.admin.routes.javascript.TrainingsTaskAdministration.delete,
        controllers.admin.routes.javascript.TaskAdministration.delete,
        controllers.admin.routes.javascript.ProjectAdministration.create,
        controllers.admin.routes.javascript.ProjectAdministration.delete

      )).as("text/javascript")
  }

  def index() = UserAwareAction.async { implicit request =>
    request.userOpt match {
      case Some(user) =>
        UsedAnnotationDAO.oneBy(user).futureBox.map {
          case Full(annotationId) =>
            Redirect(routes.AnnotationController.trace(annotationId.annotationType, annotationId.identifier))
          case _ =>
            Redirect(routes.UserController.dashboard)
        }
      case _ =>
        Future.successful(Redirect(routes.DataSetController.list))
    }
  }

  def emptyMain = Authenticated { implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def impressum = UserAwareAction { implicit request =>
    Ok(views.html.impressum())
  }
}