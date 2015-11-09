package controllers

import javax.inject.Inject

import oxalis.security.Secured
import play.api.i18n.MessagesApi
import play.api.mvc.Action
import play.api._
import play.api.libs.concurrent.Akka
import scala.concurrent.Future
import models.user.{UsedAnnotationDAO, UsedAnnotation, UserAgentTrackingDAO}
import models.basics.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.routing.JavaScriptReverseRouter
import play.twirl.api.Html
import net.liftweb.common.Full

class Application @Inject() (val messagesApi: MessagesApi) extends Controller with Secured {
  lazy val app = play.api.Play.current

  lazy val Mailer =
    Akka.system(app).actorSelection("/user/mailActor")

  lazy val annotationStore =
    Akka.system(app).actorSelection("/user/annotationStore")

  // -- Javascript routing

  def javascriptRoutes = Action { implicit request =>
    Ok(
      JavaScriptReverseRouter("jsRoutes")(//fill in stuff which should be able to be called from js
        controllers.admin.routes.javascript.NMLIO.upload,
        controllers.admin.routes.javascript.TaskAdministration.edit,
        controllers.admin.routes.javascript.TaskAdministration.overviewData,
        controllers.routes.javascript.TaskController.request,
        controllers.routes.javascript.AnnotationController.annotationsForTask,
        controllers.routes.javascript.AnnotationController.trace,
        controllers.routes.javascript.AnnotationController.finish,
        controllers.routes.javascript.AnnotationController.finishAll,
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
