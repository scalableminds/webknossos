package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.security.Secured
import play.api.Logger
import models.user._
import models.task._
import models.annotation._
import views._
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import models.annotation.AnnotationService
import play.api.Play.current
import braingames.util.Fox
import net.liftweb.common.{Full, Failure}
import braingames.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.templates.Html

object TaskController extends Controller with Secured {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 5

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def ensureMaxNumberOfOpenTasks(user: User)(implicit ctx: DBAccessContext): Fox[Int] = {
    AnnotationService.countOpenTasks(user).flatMap{ numberOfOpen => Future.successful(
      if (numberOfOpen < MAX_OPEN_TASKS)
        Full(numberOfOpen)
      else
        Failure(Messages("task.tooManyOpenOnes"))
    )}
  }

  def requestTaskFor(user: User)(implicit ctx: DBAccessContext) =
    TaskService.nextTaskForUser(user) orElse (Training.findAssignableFor(user).flatMap(_.headOption))

  def request = Authenticated.async { implicit request =>
    val user = request.user
    for {
      _ <- ensureMaxNumberOfOpenTasks(user)
      task <- requestTaskFor(user) ?~> Messages("task.unavailable")
      taskJSON <- Task.transformToJson(task).toFox
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- Annotation.transformToJson(annotation)
    } yield {
      val message = if (task.isTraining)
        Messages("task.training.assigned")
      else
        Messages("task.assigned")

      JsonOk(Json.obj( "tasks" -> taskJSON, "annotations" -> annotationJSON), message)
    }
  }
}