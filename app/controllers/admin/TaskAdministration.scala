package controllers.admin

import java.util.Locale

import scala.util.matching.Regex

import reactivemongo.bson.BSONObjectID

import scala.Array.canBuildFrom
import scala.Option.option2Iterable
import oxalis.security.AuthenticatedRequest
import oxalis.security.Secured
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.geometry.{Vector3D, Point3D, BoundingBox}
import models.binary.DataSet
import models.tracing._
import models.task._
import models.user._
import models.binary.DataSetDAO
import play.api.data.Form
import play.api.data.Forms._
import views.html
import play.api.i18n.Messages
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import java.lang.Cloneable
import play.api.Logger
import play.api.mvc.{SimpleResult, Result}
import play.api.templates.Html
import oxalis.annotation._
import controllers.{Controller, Application}
import models.annotation.{AnnotationService, Annotation, AnnotationDAO, AnnotationType}
import scala.concurrent.Future
import oxalis.nml.NMLService
import play.api.libs.json.{Json, JsObject, JsArray}
import play.api.libs.json.Json._
import play.api.libs.json.JsObject

import play.api.libs.json._
import play.api.libs.functional.syntax._

import net.liftweb.common.{Empty, Failure, Full}
import com.scalableminds.util.tools.Fox
import play.api.mvc.SimpleResult
import play.api.mvc.Request
import play.api.mvc.AnyContent
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.team.Team
import models.user.time.{TimeSpan, TimeSpanService}
import scala.concurrent.duration._
import scala.concurrent.duration

object TaskAdministration extends AdminController {

  val taskFromNMLForm = nmlTaskForm(minTaskInstances = 1)

  type TaskForm = Form[(String, String, Point3D, Experience, Int, Int, String)]

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  // Vector helpers
  val vectorForm = "\\s*([0-9]+(?:\\.[0-9]+)?),\\s*([0-9]+(?:\\.[0-9]+)?),\\s*([0-9]+(?:\\.[0-9]+)?)\\s*"
  val vectorFormRx = vectorForm.r

  def VectorToForm(p: Vector3D) = Some("%f, %f, %f".formatLocal(Locale.ENGLISH, p.x, p.y, p.z))

  def VectorFromForm(s: String) = {
    s match {
      case vectorFormRx(x, y, z) =>
        Vector3D(x.toFloat, y.toFloat, z.toFloat)
      case _ =>
        null
    }
  }

  def basicTaskForm(minTaskInstances: Int) = Form(
    tuple(
      "taskType" -> text,
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.fromForm)(Experience.unapply),
      "priority" -> number,
      "taskInstances" -> number.verifying("task.edit.toFewInstances",
        taskInstances => taskInstances >= minTaskInstances),
      "team" -> nonEmptyText,
      "project" -> text
    )).fill(("", Experience.empty, 100, 10, "", ""))

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
        b => b.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*,\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(BoundingBox.fromForm)(BoundingBox.toForm)
    )).fill(("", Experience.empty, 100, 10, "", "", BoundingBox(Point3D(0, 0, 0), 0, 0, 0)))

  val taskMapping = tuple(
    "dataSet" -> text,
    "taskType" -> text,
    "start" -> mapping(
      "point" -> text.verifying("point.invalid",
        p => p.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(Point3D.fromForm)(Point3D.toForm),
    "rotation" -> mapping(
      "vector" -> text.verifying("vector.invalid",
        p => p.matches(vectorForm)))(VectorFromForm)(VectorToForm),
    "experience" -> mapping(
      "domain" -> text,
      "value" -> number)(Experience.fromForm)(Experience.unapply),
    "priority" -> number,
    "taskInstances" -> number,
    "team" -> nonEmptyText,
    "project" -> text,
    "isForAnonymous" -> boolean,
    "boundingBox" -> mapping(
      "box" -> text.verifying("boundingBox.invalid",
        b => b.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*,\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(BoundingBox.fromForm)(BoundingBox.toForm)
  )

  val taskForm = Form(
    taskMapping).fill("", "", Point3D(0, 0, 0), Vector3D(0, 0, 1), Experience.empty, 100, 10, "", "", false, BoundingBox(Point3D(0, 0, 0), 0, 0, 0))

  def taskCreateHTML(
                      taskFromNMLForm: Form[_],
                      taskForm: Form[_]
                    )(implicit request: AuthenticatedRequest[_]) =
    for {
      dataSets <- DataSetDAO.findAll
      projects <- ProjectDAO.findAll
      taskTypes <- TaskTypeDAO.findAll
    } yield {
      html.admin.task.taskCreate(
        taskTypes,
        dataSets,
        projects,
        request.user.adminTeamNames,
        taskFromNMLForm,
        taskForm)
    }

  def taskEditHtml(taskId: String, taskForm: Form[_])(implicit request: AuthenticatedRequest[_]) =
    for {
      projects <- ProjectDAO.findAll
      taskTypes <- TaskTypeDAO.findAll
    } yield {
      html.admin.task.taskEdit(
        taskId,
        taskTypes,
        projects,
        request.user.adminTeamNames,
        taskForm)
    }

  def create = Authenticated.async { implicit request =>
    taskCreateHTML(taskFromNMLForm, taskForm).map(html => Ok(html))
  }

  def delete(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- TaskService.remove(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def createAnonymousUsersAndTasksInstances(task: Task)(implicit request: AuthenticatedRequest[_]) =
    Fox.sequenceOfFulls((1 to task.instances).toList.map { i =>
      for {
        user <- UserService.insertAnonymousUser(task.team, task.neededExperience)
        loginToken <- UserService.createLoginToken(user, validDuration = 30 days)
        annotation <- AnnotationService.createAnnotationFor(user, task)
      } yield {
        val url = controllers.routes.AnnotationController.trace(annotation.typ, annotation.id).absoluteURL(secure = true)
        url + "?loginToken=" + loginToken
      }
    })

  def createFromForm = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    def createResult(isForAnonymous: Boolean, task: Task): Fox[SimpleResult] = {
      if(isForAnonymous){
        createAnonymousUsersAndTasksInstances(task).map{ links =>
          Ok(s"Created task with id: ${task.id}. Links:\n" + links.mkString("\n"))
        }
      } else {
        Fox.successful(
          Redirect(controllers.routes.TaskController.empty)
            .flashing(
              FlashSuccess(Messages("task.createSuccess")))
            .highlighting(task.id))
      }
    }

    taskForm.bindFromRequest.fold(
    formWithErrors => taskCreateHTML(taskFromNMLForm, formWithErrors).map(html => BadRequest(html)), {
      case (dataSetName, taskTypeId, start, rotation, experience, priority, instances, team, projectName, isForAnonymous, boundingBox) =>
        for {
          dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
          _ <- ensureTeamAdministration(request.user, team).toFox
          task = Task(taskType._id, team, experience, priority, instances, _project = project.map(_.name))
          _ <- TaskDAO.insert(task)
          _ <- AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, dataSetName, start, rotation)
          result <- createResult(isForAnonymous, task)
        } yield {
          result
        }
    })
  }

  def edit(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team).toFox
      projectName <- task.project.map(_.name) getOrElse ""
      form = basicTaskForm(task.assignedInstances).fill(
        (task._taskType.stringify,
          task.neededExperience,
          task.priority,
          task.instances,
          task.team,
          projectName))
      html <- taskEditHtml(task.id, form)
    } yield {
      Ok(html)
    }
  }

  def editTaskForm(taskId: String) = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    def validateForm(task: Task): Fox[SimpleResult] =
      basicTaskForm(task.assignedInstances).bindFromRequest.fold(
        hasErrors = (formWithErrors => taskEditHtml(taskId, formWithErrors).map(h => BadRequest(h))),
        success = {
          case (taskTypeId, experience, priority, instances, team, projectName) =>
            for {
              taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
              project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
              _ <- TaskDAO.update(
                _task = task._id,
                _taskType = taskType._id,
                neededExperience = experience,
                priority = priority,
                instances = instances,
                team = team,
                _project = project.map(_.name))
            } yield {
              AnnotationDAO.updateAllUsingNewTaskType(task, taskType.settings)
              Redirect(controllers.routes.TaskController.empty)
              .flashing(
                FlashSuccess(Messages("task.editSuccess")))
              .highlighting(task.id)
            }
        })

    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team).toFox
      result <- validateForm(task)
    } yield {
      result
    }
  }

  def createFromNML = Authenticated.async(parse.multipartFormData) { implicit request =>
    taskFromNMLForm.bindFromRequest.fold(
      hasErrors = (formWithErrors => taskCreateHTML(formWithErrors, taskForm).map(html => BadRequest(html))),
      success = {
        case (taskTypeId, experience, priority, instances, team, projectName, boundingBox) =>
          for {
            nmlFile <- request.body.file("nmlFile") ?~> Messages("nml.file.notFound")
            taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
            project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
            _ <- ensureTeamAdministration(request.user, team)
          } yield {
            val nmls = NMLService.extractFromFile(nmlFile.ref.file, nmlFile.filename).flatten
            val baseTask = Task(
              taskType._id,
              team,
              experience,
              priority,
              instances,
              _project = project.map(_.name))
            nmls.foreach {
              nml =>
                val task = Task(
                  taskType._id,
                  team,
                  experience,
                  priority,
                  instances,
                  _project = project.map(_.name),
                  _id = BSONObjectID.generate)
                TaskDAO.insert(task).flatMap { _ =>
                  AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, nml)
                }
            }
            Redirect(controllers.routes.TaskController.empty).flashing(
              FlashSuccess(Messages("task.bulk.createSuccess", nmls.size)))
          }
      })
  }

  def createBulk = Authenticated.async(parse.urlFormEncoded(1024 * 1024)) { implicit request =>
    def extractParamLines(data: String) =
      data
      .split("\n")
      .map(_.split(",").map(_.trim))
      .filter(_.length >= 9)

    def parseParamLine(params: Array[String]) = {
      val projectName = if (params.length >= 17) params(16) else ""
      for {
        project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
        experienceValue <- params(3).toIntOpt ?~> "Invalid experience value"
        x <- params(4).toIntOpt ?~> "Invalid x value"
        y <- params(5).toIntOpt ?~> "Invalid y value"
        z <- params(6).toIntOpt ?~> "Invalid z value"
        priority <- params(7).toIntOpt ?~> "Invalid priority value"
        instances <- params(8).toIntOpt ?~> "Invalid instances value"
        taskTypeSummary = params(1)
        team = params(9)
        minX <- params(10).toIntOpt ?~> "Invalid minX value"
        minY <- params(11).toIntOpt ?~> "Invalid minY value"
        minZ <- params(12).toIntOpt ?~> "Invalid minZ value"
        maxX <- params(13).toIntOpt ?~> "Invalid maxX value"
        maxY <- params(14).toIntOpt ?~> "Invalid maxY value"
        maxZ <- params(15).toIntOpt ?~> "Invalid maxZ value"
        _ <- ensureTeamAdministration(request.user, team).toFox
        taskType <- TaskTypeDAO.findOneBySumnary(taskTypeSummary) ?~> Messages("taskType.notFound")
      } yield {
        val dataSetName = params(0)
        val experience = Experience(params(2), experienceValue)
        val position = Point3D(x, y, z)
        val boundingBox = BoundingBox.createFrom(Point3D(minX, minY, minZ), Point3D(maxX, maxY, maxZ))
        val task = Task(
          taskType._id,
          team,
          experience,
          priority,
          instances,
          _project = project.map(_.name))
        (dataSetName, position, boundingBox, taskType, task)
      }
    }

    def createTasksFromData(data: String) =
      Fox.sequence(extractParamLines(data).map(parseParamLine).toList).map { results =>
        results.flatMap{
          case Full((dataSetName, position, boundingBox, taskType, task)) =>
            TaskDAO.insert(task)
            AnnotationService.createAnnotationBase(task, request.user._id, boundingBox, taskType.settings, dataSetName, position, Vector3D(0,0,1))
            Full(task)
          case f: Failure =>
            Logger.warn("Failure while creating bulk tasks: " + f)
            f
          case Empty =>
            Logger.warn("Failure while creating bulk tasks. Parsing the input failed")
            Failure("Failure while creating bulk tasks. Parsing the input failed.")
        }
      }

    for {
      data <- postParameter("data") ?~> Messages("task.bulk.notSupplied")
      inserted <- createTasksFromData(data)
    } yield {
      Redirect(controllers.routes.TaskController.empty).flashing(
        FlashSuccess(Messages("task.bulk.createSuccess", inserted.size.toString)))
    }
  }

  def dataSetNamesForTasks(tasks: List[Task])(implicit ctx: DBAccessContext) =
    Future.traverse(tasks)(_.annotationBase.flatMap(_.dataSetName getOrElse "").futureBox.map(_.toOption))

  def tasksForType(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      tasks <- TaskDAO.findAllByTaskType(taskType)
      js <- Future.traverse(tasks)(Task.transformToJson)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  case class UserWithTaskInfos(
    user: User,
    taskTypes: List[TaskType],
    projects: List[Project],
    futureTaskType: Option[TaskType],
    workingTime: Long)

  object UserWithTaskInfos {
    def userInfosPublicWrites(requestingUser: User): Writes[UserWithTaskInfos] =
      ( (__ \ "user").write(User.userPublicWrites(requestingUser)) and
        (__ \ "taskTypes").write[List[TaskType]] and
        (__ \ "projects").write[List[Project]] and
        (__ \ "futureTaskType").write[Option[TaskType]] and
        (__ \ "workingTime").write[Long])( u =>
        (u.user, u.taskTypes, u.projects, u.futureTaskType, u.workingTime))
  }

  def overviewData(start: Option[Long], end: Option[Long]) = Authenticated.async { implicit request =>

    def getUserInfos(users: List[User]) = {

      val futureTaskTypeMap = for {
        futureTasks <- TaskService.simulateTaskAssignment(users)
        futureTaskTypes <- Fox.sequenceOfFulls(futureTasks.map(e => e._2.taskType.map(e._1 -> _)).toList)
      } yield {
        futureTaskTypes.toMap
      }

      Future.traverse(users){user =>
        for {
          annotations <- AnnotationService.openTasksFor(user).getOrElse(Nil)
          tasks <- Fox.sequenceOfFulls(annotations.map(_.task))
          projects <- Fox.sequenceOfFulls(tasks.map(_.project))
          taskTypes <- Fox.sequenceOfFulls(tasks.map(_.taskType))
          taskTypeMap <- futureTaskTypeMap getOrElse(Map.empty)
          workingTime <- TimeSpanService.totalTimeOfUser(user, start, end).futureBox
        } yield {
          UserWithTaskInfos(
            user,
            taskTypes.distinct,
            projects.distinct,
            taskTypeMap.get(user),
            workingTime.map(_.toMillis).toOption.getOrElse(0)
          )
        }
      }
    }

    for {
      users <- UserService.findAllNonAnonymous()
      userInfos <- getUserInfos(users)
      allTaskTypes <- TaskTypeDAO.findAll
      allProjects <- ProjectDAO.findAll
    } yield {
      JsonOk(
        Json.obj(
          "userInfos" -> Writes.list(UserWithTaskInfos.userInfosPublicWrites(request.user)).writes(userInfos),
          "taskTypes" -> allTaskTypes,
          "projects" -> allProjects
        )
      )
    }

  }

}
