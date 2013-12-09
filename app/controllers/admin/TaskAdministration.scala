package controllers.admin

import scala.Array.canBuildFrom
import scala.Option.option2Iterable
import oxalis.security.AuthenticatedRequest
import oxalis.security.Secured
import braingames.util.ExtendedTypes.ExtendedString
import braingames.geometry.Point3D
import braingames.binary.models.DataSet
import models.security.{RoleDAO, Role}
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
import org.bson.types.ObjectId
import net.liftweb.common.Full
import net.liftweb.common.Full
import braingames.util.Fox
import play.api.mvc.SimpleResult

object TaskAdministration extends AdminController {

  val taskFromNMLForm = basicTaskForm(minTaskInstances = 1)

  type TaskForm = Form[(String, String, Point3D, Experience, Int, Int, String)]

  def basicTaskForm(minTaskInstances: Int) = Form(
    tuple(
      "taskType" -> text,
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.fromForm)(Experience.unapply),
      "priority" -> number,
      "taskInstances" -> number.verifying("task.edit.toFewInstances",
        taskInstances => taskInstances >= minTaskInstances),
      "project" -> text)
  ).fill(("", Experience.empty, 100, 10, ""))

  val taskMapping = tuple(
    "dataSet" -> text,
    "taskType" -> text,
    "start" -> mapping(
      "point" -> text.verifying("point.invalid",
        p => p.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(Point3D.fromForm)(Point3D.toForm),
    "experience" -> mapping(
      "domain" -> text,
      "value" -> number)(Experience.fromForm)(Experience.unapply),
    "priority" -> number,
    "taskInstances" -> number,
    "project" -> text)

  val taskForm = Form(
    taskMapping).fill("", "", Point3D(0, 0, 0), Experience.empty, 100, 10, "")

  def list = Authenticated().async { implicit request =>
    render.async {
      case Accepts.Html() =>
        Future.successful(Ok(html.admin.task.taskList()))
      case Accepts.Json() =>
        for {
          tasks <- TaskService.findAllNonTrainings
          js <- Future.traverse(tasks)(Task.transformToJson)
        } yield {
          JsonOk(Json.obj("data" -> js))
        }
    }
  }

  def taskCreateHTML(
                      taskFromNMLForm: Form[(String, Experience, Int, Int, String)],
                      taskForm: Form[(String, String, Point3D, Experience, Int, Int, String)]
                    )(implicit request: AuthenticatedRequest[_]) =
    for {
      dataSets <- DataSetDAO.findAll
      projects <- ProjectDAO.findAll
      taskTypes <- TaskTypeDAO.findAll
      domains <- ExperienceService.findAllDomains
    } yield {
      html.admin.task.taskCreate(
        taskTypes,
        dataSets,
        domains.toList,
        projects,
        taskFromNMLForm,
        taskForm)
    }

  def taskEditHtml(taskId: String, taskForm: Form[(String, Experience, Int, Int, String)])(implicit request: AuthenticatedRequest[_]) =
    for {
      projects <- ProjectDAO.findAll
      taskTypes <- TaskTypeDAO.findAll
      domains <- ExperienceService.findAllDomains
    } yield {
      html.admin.task.taskEdit(
        taskId,
        taskTypes,
        domains.toList,
        projects,
        taskForm)
    }

  def create = Authenticated().async { implicit request =>
    taskCreateHTML(taskFromNMLForm, taskForm).map(html => Ok(html))
  }

  def delete(taskId: String) = Authenticated().async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- TaskService.remove(task._id)
    } yield {
      JsonOk(Messages("task.removed"))
    }
  }

  def createFromForm = Authenticated().async(parse.urlFormEncoded) { implicit request =>
    taskForm.bindFromRequest.fold(
    formWithErrors => taskCreateHTML(taskFromNMLForm, formWithErrors).map(html => BadRequest(html)), {
      case (dataSetName, taskTypeId, start, experience, priority, instances, projectName) =>
        for {
          dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
          taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
          project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
          task = Task(0, taskType._id, experience, priority, instances, _project = project.map(_.name))
          _ <- TaskDAO.insert(task)
        } yield {
          AnnotationService.createAnnotationBase(task, new ObjectId(request.user._id.stringify), taskType.settings, dataSetName, start)
          Redirect(routes.TaskAdministration.list)
          .flashing(
            FlashSuccess(Messages("task.createSuccess")))
          .highlighting(task.id)
        }
    })
  }

  def edit(taskId: String) = Authenticated().async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      projectName <- task.project.map(_.name) getOrElse ""
      form = basicTaskForm(task.assignedInstances).fill(
        (task._taskType.toString,
          task.neededExperience,
          task.priority,
          task.instances,
          projectName))
      html <- taskEditHtml(task.id, form)
    } yield {
      Ok(html)
    }
  }

  def editTaskForm(taskId: String) = Authenticated().async(parse.urlFormEncoded) { implicit request =>
    def validateForm(task: Task): Fox[SimpleResult] =
      basicTaskForm(task.assignedInstances).bindFromRequest.fold(
        hasErrors = (formWithErrors => taskEditHtml(taskId, formWithErrors).map(h => BadRequest(h))),
        success = {
          case (taskTypeId, experience, priority, instances, projectName) =>
            for {
              taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
              project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
              _ <- TaskDAO.update(
                _task = task._id,
                _taskType = taskType._id,
                neededExperience = experience,
                priority = priority,
                instances = instances,
                _project = project.map(_.name))
            } yield {
              AnnotationDAO.updateAllUsingNewTaskType(task, taskType.settings)
              Redirect(routes.TaskAdministration.list)
              .flashing(
                FlashSuccess(Messages("task.editSuccess")))
              .highlighting(task.id)
            }
        })

    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      result <- validateForm(task)
    } yield {
      result
    }
  }

  def createFromNML = Authenticated().async(parse.multipartFormData) { implicit request =>
    taskFromNMLForm.bindFromRequest.fold(
      hasErrors = (formWithErrors => taskCreateHTML(formWithErrors, taskForm).map(html => BadRequest(html))),
      success = {
        case (taskTypeId, experience, priority, instances, projectName) =>
          for {
            nmlFile <- request.body.file("nmlFile") ?~> Messages("nml.file.notFound")
            taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
            project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
          } yield {
            val nmls = NMLService.extractFromFile(nmlFile.ref.file, nmlFile.filename)
            val baseTask = Task(
              0,
              taskType._id,
              experience,
              priority,
              instances,
              _project = project.map(_.name))
            nmls.foreach {
              nml =>
                TaskService.copyDeepAndInsert(baseTask).map { task =>
                  AnnotationService.createAnnotationBase(task, new ObjectId(request.user.id), taskType.settings, nml)
                }
            }
            Redirect(routes.TaskAdministration.list).flashing(
              FlashSuccess(Messages("task.bulk.createSuccess", nmls.size)))
          }
      })
  }

  def createBulk = Authenticated().async(parse.urlFormEncoded) { implicit request =>
    def extractParamLines(data: String) =
      data
      .split("\n")
      .map(_.split(" ").map(_.trim))
      .filter(_.length >= 9)

    def parseParamLine(params: Array[String]) = {
      val projectName = if (params.length >= 10) params(9) else ""
      for {
        project <- ProjectService.findIfNotEmpty(projectName) ?~> Messages("project.notFound")
        experienceValue <- params(3).toIntOpt ?~> "Invalid experience value"
        x <- params(4).toIntOpt ?~> "Invalid x value"
        y <- params(5).toIntOpt ?~> "Invalid y value"
        z <- params(6).toIntOpt ?~> "Invalid z value"
        priority <- params(7).toIntOpt ?~> "Invalid priority value"
        instances <- params(8).toIntOpt ?~> "Invalid instances value"
        taskTypeSummary = params(1)
        taskType <- TaskTypeDAO.findOneBySumnary(taskTypeSummary) ?~> Messages("taskType.notFound")
      } yield {
        val dataSetName = params(0)
        val experience = Experience(params(2), experienceValue)
        val position = Point3D(x, y, z)
        val task = Task(
          0,
          taskType._id,
          experience,
          priority,
          instances,
          _project = project.map(_.name))
        (dataSetName, position, taskType, task)
      }
    }

    def createTasksFromData(data: String) =
      Fox.sequence(extractParamLines(data).map(parseParamLine).toList).map { results =>
        results.flatMap(_.map {
          case (dataSetName, position, taskType, task) =>
            TaskDAO.insert(task)
            AnnotationService.createAnnotationBase(task, new ObjectId(request.user._id.stringify), taskType.settings, dataSetName, position)
            task
        })
      }

    for {
      data <- postParameter("data") ?~> Messages("task.bulk.notSupplied")
      inserted <- createTasksFromData(data)
    } yield {
      Redirect(routes.TaskAdministration.list).flashing(
        FlashSuccess(Messages("task.bulk.createSuccess", inserted.size.toString)))
    }
  }

  def tasksForProject(projectName: String) = Authenticated().async { implicit request =>
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound")
      tasks <- project.tasks
    } yield {
      val result = tasks.foldLeft(Html.empty) {
        case (h, e) => h += html.admin.task.simpleTask(e)
      }
      Ok(result)
    }
  }

  def tasksForType(taskTypeId: String) = Authenticated().async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      tasks <- TaskDAO.findAllByTaskType(taskType)
    } yield {
      val result = tasks.foldLeft(Html.empty) {
        case (h, e) => h += html.admin.task.simpleTask(e)
      }
      Ok(result)
    }
  }

  def overview = Authenticated().async { implicit request =>
    def combineUsersWithCurrentTasks(users: List[User]) = Future.traverse(users)(user =>
      for {
        annotations <- AnnotationService.openTasksFor(user)
        tasks <- Fox.sequence(annotations.map(_.task)).map(_.flatten)
        taskTypes <- Fox.sequence(tasks.map(_.taskType)).map(_.flatten)
      } yield {
        user -> taskTypes.distinct
      })

    for {
      users <- UserService.findAll
      allTaskTypes <- TaskTypeDAO.findAll
      usersWithTasks <- combineUsersWithCurrentTasks(users)
      futureUserTaskAssignment <- TaskService.simulateTaskAssignment(users)
      futureTaskTypes <- Fox.sequence(futureUserTaskAssignment.map(e => e._2.taskType.map(e._1 -> _)).toList)
    } yield {
      Ok(html.admin.task.taskOverview(users, allTaskTypes, usersWithTasks.toMap, futureTaskTypes.flatten.toMap))
    }
  }
}