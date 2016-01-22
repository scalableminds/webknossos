package controllers

import java.io.File

import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import com.scalableminds.util.mvc.JsonResult
import models.binary.DataSetDAO
import javax.inject.Inject
import net.liftweb.common.Full
import oxalis.nml.NMLService
import play.api.data.Form
import play.api.data.Forms._
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
import play.api.mvc.AnyContent
import play.twirl.api.Html
import scala.concurrent.Future
import play.api.libs.json._
import play.api.libs.functional.syntax._
import reactivemongo.bson.BSONObjectID

class TaskController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits with TaskFromNMLCreation{

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

  def bulkCreate(json: JsValue)(implicit request: AuthenticatedRequest[_]) = {
    json.validate(Reads.list(taskJsonReads)) match {
      case JsSuccess(parsed, _) =>
        val results = parsed.map(p => createSingleTask(p).map(_ => Messages("task.create.success")))
        bulk2StatusJson(results).map(js => JsonOk(js, Messages("task.bulk.processed")))
      case errors: JsError =>
        Future.successful(JsonBadRequest(jsonErrorWrites(errors), Messages("format.json.invalid")))
    }
  }

  def create(`type`: String = "default") = Authenticated.async{ implicit request =>
    `type` match {
      case "default" =>
        val r = request.body.asJson
        .map{json => json.validate(taskJsonReads) match {
          case JsSuccess(parsed, _) =>
            createSingleTask(parsed).map(_ => JsonOk(Messages("task.create.success")))
          case errors: JsError =>
            Fox.successful(JsonBadRequest(jsonErrorWrites(errors), Messages("task.create.failed")))
        }}
        .getOrElse(Fox.successful(JsonBadRequest(Messages("format.json.invalid"))))
        r
      case "nml" =>
        createFromNML(request)
      case "bulk" =>
        request.body.asJson
        .map(json => bulkCreate(json))
        .getOrElse(Fox.successful(JsonBadRequest(Messages("format.json.invalid"))))
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

trait TaskFromNMLCreation extends Controller{
  import play.api.data.Form
  import play.api.data.Forms._

  val taskFromNMLForm = nmlTaskForm(minTaskInstances = 1)

  def nmlTaskForm(minTaskInstances: Int) = Form(
    tuple(
      "taskType" -> text,
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.fromForm)(Experience.unapply),
      "priority" -> number,
      "taskInstances" -> number.verifying("task.edit.toFewInstances",
        taskInstances => taskInstances >= minTaskInstances),
      "team" -> nonEmptyText,
      "project" -> text,
      "boundingBox" -> mapping(
        "box" -> text.verifying("boundingBox.invalid",
          b => b.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*,\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(BoundingBox.fromForm)(b => b.map(BoundingBox.toForm).toOption.flatten)
    )).fill(("", Experience.empty, 100, 10, "", "", Full(BoundingBox(Point3D(0, 0, 0), 0, 0, 0))))

  def createFromNML(implicit request: AuthenticatedRequest[AnyContent]) = {
    taskFromNMLForm.bindFromRequest.fold(
      hasErrors = formWithErrors => Fox.successful(JsonBadRequest(Json.obj("errors" -> formWithErrors.errorsAsJson), Messages("invalid"))),
      success = {
        case (taskTypeId, experience, priority, instances, team, projectName, boundingBox) =>
          for {
            body <- request.body.asMultipartFormData ?~> Messages("invalid")
            nmlFile <- body.file("nmlFile") ?~> Messages("nml.file.notFound")
            taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
            project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
            _ <- ensureTeamAdministration(request.user, team)
            bb <- boundingBox
          } yield {
            val nmls = NMLService.extractFromFile(nmlFile.ref.file, nmlFile.filename)
            var numCreated = 0

            val baseTask = Task(
              taskType._id,
              team,
              experience,
              priority,
              instances,
              _project = project.map(_.name))

            nmls.foreach {
              case NMLService.NMLParseSuccess(_, nml) =>
                val task = Task(
                  taskType._id,
                  team,
                  experience,
                  priority,
                  instances,
                  _project = project.map(_.name),
                  _id = BSONObjectID.generate)
                TaskDAO.insert(task).flatMap { _ =>
                  AnnotationService.createAnnotationBase(task, request.user._id, bb, taskType.settings, nml)
                }
                numCreated += 1
              case _ =>

            }
            JsonOk(Messages("task.bulk.createSuccess", numCreated))
          }
      })
  }
}
