package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.security.Secured
import models.security.Role
import play.api.Logger
import models.user._
import models.task._
import views._
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import braingames.mvc.Controller
import models.annotation.{AnnotationDAO, AnnotationType}
import play.api.Play.current
import models.tracing.skeleton.SkeletonTracing

object TaskController extends Controller with Secured {
  override val DefaultAccessRole = Role.User
  
  val MAX_OPEN_TASKS = current.configuration.getInt("tasks.maxOpenPerUser") getOrElse 5

  def request = Authenticated { implicit request =>
    Async {
      val user = request.user
      if (AnnotationDAO.countOpenAnnotations(request.user, AnnotationType.Task) < MAX_OPEN_TASKS) {
        Task.nextTaskForUser(request.user).map {
          case Some(task) =>
            for {
              annotation <- AnnotationDAO.createAnnotationFor(user, task) ?~ Messages("annotation.creationFailed")
            } yield {
              JsonOk(html.user.dashboard.taskAnnotationTableItem(task, annotation), Messages("task.assigned"))
            }
          case _ =>
            for {
              task <- Training.findAssignableFor(user).headOption ?~ Messages("task.unavailable")
              annotation <- AnnotationDAO.createAnnotationFor(user, task) ?~ Messages("annotation.creationFailed")
            } yield {
              JsonOk(html.user.dashboard.taskAnnotationTableItem(task, annotation), Messages("task.training.assigned"))
            }
        }
      } else{
        Promise.pure(JsonBadRequest(Messages("task.tooManyOpenOnes")))
      }
    }
  }
}