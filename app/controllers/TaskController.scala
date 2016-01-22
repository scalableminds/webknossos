package controllers

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import models.binary.DataSetDAO
import javax.inject.Inject
import play.api.libs.json.Json._
import oxalis.security.{AuthenticatedRequest, Secured}
import models.user._
import models.task._
import models.annotation._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.{MessagesApi, Messages}
import models.annotation.AnnotationService
import play.api.Play.current
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.twirl.api.Html
import scala.concurrent.Future
import play.api.libs.json._
import play.api.libs.functional.syntax._

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {

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

  def createSingleTask(input: (String, String, Point3D, Experience, Int, CompletionStatus, String, String, BoundingBox))(implicit request: AuthenticatedRequest[_]) =
    input match {
      case (dataSetName, taskTypeId, start, experience, priority, status, team, projectName, boundingBox) =>
        for {
          dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
          _ <- ensureTeamAdministration(request.user, team).toFox
          task = Task(taskType._id, team, experience, priority, status.open, _project = project.map(_.name))
          _ <- TaskDAO.insert(task)
        } yield {
          AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, dataSetName, start)
          task
        }
    }

  def bulkCreate(implicit request: AuthenticatedRequest[JsValue]) = {
    request.body.validate(Reads.list(taskJsonReads)) match {
      case JsSuccess(parsed, _) =>
        val results = parsed.map(p => createSingleTask(p).map(_ => Messages("task.createSuccess")))
        bulk2StatusJson(results).map(js => JsonOk(js, Messages("task.bulk.processed")))
      case _ =>
        Future.successful(JsonBadRequest("Invalid task create json"))
    }
  }

  def create() = Authenticated.async(parse.json){ implicit request =>
    request.body.validate(taskJsonReads) match {
      case JsSuccess(parsed, _) =>
        createSingleTask(parsed).map(_ =>  JsonOk(Messages("task.createSuccess")))
      case _ =>
        bulkCreate(request)
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
