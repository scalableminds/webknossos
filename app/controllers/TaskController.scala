package controllers

import javax.inject.Inject

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
import play.api.i18n.{MessagesApi, Messages}
import models.annotation.AnnotationService
import play.api.Play.current
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import net.liftweb.common.{Full, Failure}
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.{Promise, Future}
import play.twirl.api.Html
import scala.concurrent.Future
import scala.async.Async.{async, await}
import net.liftweb.common.Box

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {

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
    AnnotationService.countOpenTasks(user).flatMap{ numberOfOpen =>
      if (numberOfOpen < MAX_OPEN_TASKS)
        Fox.successful(numberOfOpen)
      else
        Fox.failure(Messages("task.tooManyOpenOnes"))
    }
  }

  def createAvailableTasksJson(availableTasksMap: Map[User, (Int, List[Project])]) =
    Json.toJson(availableTasksMap.map { case (user, (taskCount, projects)) =>
        Json.obj(
          "name" -> user.name,
          "availableTaskCount" -> taskCount,
          "projects" -> projects.map(_.name)
        )
    })

  def requestAvailableTasks = Authenticated.async { implicit request =>
    for {
      availableTasksMap <- TaskService.getAllAvailableTaskCountsAndProjects()
    } yield {
      Ok(createAvailableTasksJson(availableTasksMap))
    }
  }

  def request = Authenticated.async { implicit request =>
    val user = request.user
    for {
      _ <- ensureMaxNumberOfOpenTasks(user)
      task <- TaskService.nextTaskForUser(user) ?~> Messages("task.unavailable")
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), exclude = List("content", "actions"))
    } yield {
      JsonOk(annotationJSON, Messages("task.assigned"))
    }
  }
}
