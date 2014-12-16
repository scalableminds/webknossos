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
import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Full, Failure}
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.twirl.api.Html

object TaskController extends Controller with Secured {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def list = Authenticated.async{ implicit request =>
    for {
      tasks <- TaskService.findAllAdministratable(request.user)
      js <- Future.traverse(tasks)(Task.transformToJson)
    } yield {
      Ok(Json.toJson(js))
    }
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
    TaskService.nextTaskForUser(user)

  def request = Authenticated.async { implicit request =>
    val user = request.user
    for {
      _ <- ensureMaxNumberOfOpenTasks(user)
      task <- requestTaskFor(user) ?~> Messages("task.unavailable")
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), List("content", "actions"))
    } yield {
      JsonOk(annotationJSON)
    }
  }
}
