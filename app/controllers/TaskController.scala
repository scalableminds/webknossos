package controllers

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import controllers.admin.TaskAdministration._
import models.binary.DataSetDAO
import play.api.data.Forms._
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
import play.api.libs.functional.syntax._

object TaskController extends Controller with Secured {

  val MAX_OPEN_TASKS = current.configuration.getInt("oxalis.tasks.maxOpenPerUser") getOrElse 2

  val taskJsonReads =
    ((__ \ 'dataSet).read[String] and
      (__ \ 'taskTypeId).read[String] and
      (__ \ 'editPosition).read[Point3D] and
      (__ \ 'neededExperience).read[Experience] and
      (__ \ 'priority).read[Int] and
      (__ \ 'status).read[CompletionStatus] and
      (__ \ 'team).read[String] and
      (__ \ 'projectName).read[String] and
      (__ \ 'boundingBox).read[BoundingBox]).tupled

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def read(taskId: String) = Authenticated.async{ implicit request =>
    for{
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      js <- Task.transformToJson(task)
    } yield {
      Ok(js)
    }
  }

  def create() = Authenticated.async(parse.json){ implicit request =>
    "something" match {
      case x =>
        request.body.validate(taskJsonReads) match {
          case JsSuccess((dataSetName, taskTypeId, start, experience, priority, status, team, projectName, boundingBox), _) =>
            for {
              dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
              taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
              project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
              _ <- ensureTeamAdministration(request.user, team).toFox
              task = Task(taskType._id, team, experience, priority, status.open, _project = project.map(_.name))
              _ <- TaskDAO.insert(task)
            } yield {
              AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, dataSetName, start)
              Ok(Json.toJson(Messages("task.createSuccess")))
            }
        }

    }
  }

  def update(taskId: String) = Authenticated.async(parse.json) { implicit request =>
    request.body.validate(taskJsonReads) match {
      case JsSuccess((dataSetName, taskTypeId, start, experience, priority, status, team, projectName, boundingBox), _) =>
        for {
          task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
          _ <- ensureTeamAdministration(request.user, task.team).toFox

          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")

          _ <- TaskDAO.update(
            _task = task._id,
            _taskType = taskType._id,
            neededExperience = experience,
            priority = priority,
            instances = status.open,
            team = team,
            _project = project.map(_.name))
        } yield {
          AnnotationDAO.updateAllUsingNewTaskType(task, taskType.settings)
          Ok(Json.toJson(Messages("task.editSuccess")))
        }
    }
  }

  def delete(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- TaskService.remove(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def list = Authenticated.async{ implicit request =>
    for {
      tasks <- TaskService.findAllAdministratable(request.user)
      js <- Future.traverse(tasks)(Task.transformToJson)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listTasksForType(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      tasks <- TaskService.findAllByTaskType(taskTypeId)
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
