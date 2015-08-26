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
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import net.liftweb.common.{Full, Failure}
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.templates.Html
import scala.async.Async.{async, await}
import net.liftweb.common.Box

object TaskController extends Controller with Secured with FoxImplicits {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 5

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

  def getAvailableTasksFor(user: User)(implicit ctx: DBAccessContext): Fox[List[Task]] =
    TaskService.findAssignableFor(user)

  def getProjectsFor(tasks: List[Task])(implicit ctx: DBAccessContext) = {
    val projects = Future.fold[Box[Project], Set[Project]](tasks.map(_.project.futureBox))(Set()) {
      case (acc, Full(project)) => acc + project
      case (acc, _) => acc
    }
    projects map (_.toList)
  }

  def getAllAvailableTaskCountsAndProjects()(implicit ctx: DBAccessContext): Fox[Map[User, (Int, List[Project])]] = {
    UserDAO.findAll
      .flatMap { users =>
        Future.sequence( users.map { user =>
          async  {
            val tasks = await(getAvailableTasksFor(user).futureBox) openOr List()
            val taskCount = tasks.size
            val projects = await(getProjectsFor(tasks))
            user ->(taskCount, projects)
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
          "projects" -> projects.map(project => project.name)
        )
    })


  def requestAvailableTasks = Authenticated.async { implicit request =>
    for {
      availableTasksMap <- getAllAvailableTaskCountsAndProjects()
    } yield {
      Ok(createAvailableTasksJson(availableTasksMap))
    }
  }

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
