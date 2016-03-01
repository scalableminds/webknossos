package controllers

import javax.inject.Inject

import models.user.UserAgentTrackingDAO
import oxalis.security.Secured
import play.api._
import play.api.i18n.MessagesApi
import play.api.mvc.Action
import play.api.routing.JavaScriptReverseRouter
import play.twirl.api.Html

class Application @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {

  def javascriptRoutes = Action { implicit request =>
    Ok(
      JavaScriptReverseRouter("jsRoutes")(//fill in stuff which should be able to be called from js
        controllers.admin.routes.javascript.NMLIO.upload,
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
        controllers.admin.routes.javascript.NMLIO.userDownload
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
