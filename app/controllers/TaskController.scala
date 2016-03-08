package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.security.Secured
import play.api.Logger
import models.user._
import models.task._
import models.annotation._
import reactivemongo.core.commands.LastError
import views._
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages
import models.annotation.AnnotationService
import play.api.Play.current
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import net.liftweb.common.{Empty, Full, Failure, Box}
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.templates.Html
import scala.async.Async.{async, await}

object TaskController extends Controller with Secured with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 5

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
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

  def requestAssignmentFor(user: User)(implicit ctx: DBAccessContext) =
    TaskService.findAssignableFor(user)

  def getAvailableTasksFor(user: User)(implicit ctx: DBAccessContext): Fox[List[Task]] =
    TaskService.allNextTasksForUser(user)

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext): Future[List[Project]] =
    Fox.sequenceOfFulls(tasks.map(_.project)).map(_.distinct)

  def getAllAvailableTaskCountsAndProjects()(implicit ctx: DBAccessContext): Fox[Map[User, (Int, List[Project])]] = {
    UserDAO.findAllNonAnonymous
      .flatMap { users =>
        Future.sequence( users.map { user =>
          async {
            val tasks = await(getAvailableTasksFor(user).futureBox) openOr List()
            val taskCount = tasks.size
            val projects = await(getProjectsFor(tasks))
            user -> (taskCount, projects)
          }
        })
      }
      .map(_.toMap[User, (Int, List[Project])])
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
      availableTasksMap <- getAllAvailableTaskCountsAndProjects()
    } yield {
      Ok(createAvailableTasksJson(availableTasksMap))
    }
  }

  def tryToGetNextAssignmentFor(user: User, retryCount: Int = 20)(implicit ctx: DBAccessContext): Fox[OpenAssignment] = {
    requestAssignmentFor(user).futureBox.flatMap {
      case Full(assignment) =>
        OpenAssignmentService.remove(assignment).flatMap { removeResult =>
          if (removeResult.n >= 1)
            Fox.successful(assignment)
          else if (retryCount > 0)
            tryToGetNextAssignmentFor(user, retryCount - 1)
          else {
            Logger.warn(s"Failed to remove any assignment for user ${user.email}. Result: $removeResult n:${removeResult.n} ok:${removeResult.ok} code:${removeResult.code} ")
            Fox.failure(Messages("task.unavailable"))
          }
        }.futureBox
      case f: Failure =>
        Logger.warn(s"Failure while trying to getNextTask (u: ${user.email} r: $retryCount): " + f)
        if (retryCount > 0)
          tryToGetNextAssignmentFor(user, retryCount - 1).futureBox
        else {
          Logger.warn(s"Failed to retrieve any assignment after all retries (u: ${user.email}) due to FAILURE")
          Fox.failure(Messages("assignment.retrieval.failed")).futureBox
        }
      case Empty =>
        Logger.warn(s"'Empty' while trying to getNextTask (u: ${user.email} r: $retryCount)")
        if (retryCount > 0)
          tryToGetNextAssignmentFor(user, retryCount - 1).futureBox
        else {
          Logger.warn(s"Failed to retrieve any assignment after all retries (u: ${user.email}) due to EMPTY")
          Fox.failure(Messages("assignment.retrieval.failed")).futureBox
        }
    }
  }

  def request = Authenticated.async { implicit request =>
    val user = request.user
    for {
      _ <- ensureMaxNumberOfOpenTasks(user)
      assignment <- tryToGetNextAssignmentFor(user)
      task <- assignment.task
      annotation <- AnnotationService.createAnnotationFor(user, task) ?~> Messages("annotation.creationFailed")
      annotationJSON <- AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), exclude = List("content", "actions"))
    } yield {
      JsonOk(annotationJSON)
    }
  }
}
