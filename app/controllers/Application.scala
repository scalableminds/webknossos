package controllers

import oxalis.security.Secured
import play.api.mvc.Action
import play.api._
import play.api.libs.concurrent.Akka
import scala.concurrent.Future
import models.user.{UsedAnnotationDAO, UsedAnnotation, UserAgentTrackingDAO}
import models.basics.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.twirl.api.Html
import net.liftweb.common.Full

object Application extends Controller with Secured {
  lazy val app = play.api.Play.current

  lazy val Mailer =
    Akka.system(app).actorFor("/user/mailActor")

  lazy val annotationStore =
    Akka.system(app).actorFor("/user/annotationStore")

  lazy val httpUri = app.configuration.getString("http.uri").get

  def toAbsoluteUrl(relativeUrl: String) = {
    httpUri + relativeUrl
  }

  // -- Javascript routing

  def javascriptRoutes = Action { implicit request =>
    Ok(
      Routes.javascriptRouter("jsRoutes")(//fill in stuff which should be able to be called from js
        controllers.admin.routes.javascript.NMLIO.upload,
        controllers.admin.routes.javascript.TaskAdministration.edit,
        controllers.admin.routes.javascript.TaskAdministration.overviewData,
        controllers.routes.javascript.TaskController.request,
        controllers.routes.javascript.AnnotationController.annotationsForTask,
        controllers.routes.javascript.AnnotationController.trace,
        controllers.routes.javascript.AnnotationController.finish,
        controllers.routes.javascript.AnnotationController.reopen,
        controllers.routes.javascript.AnnotationController.nameExplorativeAnnotation,
        controllers.routes.javascript.AnnotationController.createExplorational,
        controllers.routes.javascript.AnnotationController.download,
        controllers.admin.routes.javascript.NMLIO.taskDownload,
        controllers.admin.routes.javascript.NMLIO.projectDownload,
        controllers.admin.routes.javascript.NMLIO.userDownload,
        controllers.admin.routes.javascript.TaskAdministration.delete
      )).as("text/javascript")
  }

  def index() = UserAwareAction { implicit request =>
    UserAgentTrackingDAO.trackUserAgent(request.userOpt.map(_._id), request.headers.get("user-agent").getOrElse("<none>"))
    request.userOpt match {
      case Some(user) =>
        Redirect("/dashboard")
      case _ =>
        Redirect("/spotlight")
    }
  }

  def emptyMain = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def impressum = UserAwareAction { implicit request =>
    Ok(views.html.impressum())
  }
}
