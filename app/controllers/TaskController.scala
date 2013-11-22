package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.security.Secured
import models.security.{RoleDAO, Role}
import play.api.Logger
import models.user._
import models.task._
import views._
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import models.annotation.{AnnotationService, AnnotationDAO, AnnotationType}
import play.api.Play.current
import models.tracing.skeleton.SkeletonTracing
import scala.concurrent.Future

object TaskController extends Controller with Secured {
  override val DefaultAccessRole = RoleDAO.User

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 5

  def request = Authenticated().async { implicit request =>
    val user = request.user
    (for {
      numberOfOpen <- AnnotationService.countOpenTasks(request.user)
      if (numberOfOpen < MAX_OPEN_TASKS)
      task <- TaskService.nextTaskForUser(request.user) orElse (Training.findAssignableFor(user).map(_.headOption))
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
    } yield {
      val message = if (task.isTraining)
        Messages("task.training.assigned")
      else
        Messages("task.assigned")

      JsonOk(Json.obj("tasks" -> task, "annotations" -> annotation))
    }) ?~> Messages("task.tooManyOpenOnes")
  }
}