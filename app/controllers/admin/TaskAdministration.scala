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
import models.task.{TaskService, Task, TaskType, Project}
import models.user.{UserService, UsedAnnotation, User, Experience}
import models.binary.DataSetDAO
import play.api.data.Form
import play.api.data.Forms._
import views.html
import play.api.i18n.Messages
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import java.lang.Cloneable
import play.api.Logger
import play.api.mvc.Result
import play.api.templates.Html
import oxalis.annotation._
import controllers.{Controller, Application}
import models.annotation.{AnnotationService, Annotation, AnnotationDAO, AnnotationType}
import scala.concurrent.Future
import oxalis.nml.NMLService
import play.api.libs.json.{Json, JsObject, JsArray}
import org.bson.types.ObjectId

object TaskAdministration extends AdminController {

  val taskFromNMLForm = basicTaskForm(minTaskInstances = 1)

  def basicTaskForm(minTaskInstances: Int) = Form(
    tuple(
      "taskType" -> text.verifying("taskType.notFound",
        taskType => TaskType.findOneById(taskType).isDefined),
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.fromForm)(Experience.unapply),
      "priority" -> number,
      "taskInstances" -> number.verifying("task.edit.toFewInstances",
        taskInstances => taskInstances >= minTaskInstances),
      "project" -> text.verifying("project.notFound",
        project => project == "" || Project.findOneByName(project).isDefined)))
                                             .fill(("", Experience.empty, 100, 10, ""))

  val taskMapping = tuple(
    "dataSet" -> text,
    "taskType" -> text.verifying("taskType.notFound",
      task => TaskType.findOneById(task).isDefined),
    "start" -> mapping(
      "point" -> text.verifying("point.invalid",
        p => p.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(Point3D.fromForm)(Point3D.toForm),
    "experience" -> mapping(
      "domain" -> text,
      "value" -> number)(Experience.fromForm)(Experience.unapply),
    "priority" -> number,
    "taskInstances" -> number,
    "project" -> text.verifying("project.notFound",
      project => project == "" || Project.findOneByName(project).isDefined))

  val taskForm = Form(
    taskMapping).fill("", "", Point3D(0, 0, 0), Experience.empty, 100, 10, "")

  def list = Authenticated {
    implicit request =>
      render {
        case Accepts.Html() => Ok(html.admin.task.taskList())
        case Accepts.Json() =>
          Async {
            for {
              js <- Future.traverse(Task.findAllNonTrainings)(Task.transformToJson)
            } yield {
              JsonOk(Json.obj("data" -> js))
            }
          }
      }
  }

  def taskCreateHTML(
                      taskFromNMLForm: Form[(String, Experience, Int, Int, String)],
                      taskForm: Form[(String, String, Point3D, Experience, Int, Int, String)]
                    )(implicit request: AuthenticatedRequest[_]) =
    for {
      dataSets <- DataSetDAO.findAll
    } yield {
      html.admin.task.taskCreate(
        TaskType.findAll,
        dataSets,
        Experience.findAllDomains,
        Project.findAll,
        taskFromNMLForm,
        taskForm)
    }

  def taskEditHtml(taskId: String, taskForm: Form[(String, Experience, Int, Int, String)])(implicit request: AuthenticatedRequest[_]) =
    html.admin.task.taskEdit(
      taskId,
      TaskType.findAll,
      Experience.findAllDomains,
      Project.findAll,
      taskForm)

  def create = Authenticated {
    implicit request =>
      Async {
        taskCreateHTML(taskFromNMLForm, taskForm).map(html => Ok(html))
      }
  }

  def delete(taskId: String) = Authenticated {
    implicit request =>
      for {
        task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
      } yield {
        Task.removeById(task._id)
        JsonOk(Messages("task.removed"))
      }
  }

  def createFromForm = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
      Async {
        taskForm.bindFromRequest.fold(
        formWithErrors => taskCreateHTML(taskFromNMLForm, formWithErrors).map(html => BadRequest(html)), {
          case (dataSetName, taskTypeId, start, experience, priority, instances, projectName) =>
            for {
              dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
              taskType <- TaskType.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
            } yield {
              val project = Project.findOneByName(projectName)
              val task = Task.insertOne(Task(
                0,
                taskType._id,
                experience,
                priority,
                instances,
                _project = project.map(_.name)))
              AnnotationDAO.createAnnotationBase(task, new ObjectId(request.user._id.stringify), task.settings, dataSetName, start)
              Redirect(routes.TaskAdministration.list)
              .flashing(
                FlashSuccess(Messages("task.createSuccess")))
              .highlighting(task.id)
            }
        })
      }
  }

  def edit(taskId: String) = Authenticated {
    implicit request =>
      for {
        task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
      } yield {
        val form = basicTaskForm(task.assignedInstances).fill(
          (task._taskType.toString,
            task.neededExperience,
            task.priority,
            task.instances,
            task.project.map(_.name) getOrElse ""))

        Ok(taskEditHtml(task.id, form))
      }
  }

  def editTaskForm(taskId: String) = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
      for {
        task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
      } yield {
        val result: Result = basicTaskForm(task.assignedInstances).bindFromRequest.fold(
        formWithErrors => BadRequest(taskEditHtml(taskId, formWithErrors)), {
          case (taskTypeId, experience, priority, instances, projectName) =>
            for {
              taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
            } yield {
              val project = Project.findOneByName(projectName)
              task.update {
                _.copy(
                  _taskType = taskType._id,
                  neededExperience = experience,
                  priority = priority,
                  instances = instances,
                  _project = project.map(_.name))
              }
              AnnotationDAO.updateAllUsingNewTaskType(task, taskType)
              Redirect(routes.TaskAdministration.list)
              .flashing(
                FlashSuccess(Messages("task.editSuccess")))
              .highlighting(task.id)
            }
        })
        result
      }
  }

  def createFromNML = Authenticated(parser = parse.multipartFormData) {
    implicit request =>
      Async {
        taskFromNMLForm.bindFromRequest.fold(
        formWithErrors => taskCreateHTML(formWithErrors, taskForm).map(html => BadRequest(html)), {
          case (taskTypeId, experience, priority, instances, projectName) =>
            Future.successful(
              for {
                nmlFile <- request.body.file("nmlFile") ?~ Messages("nml.file.notFound")
                taskType <- TaskType.findOneById(taskTypeId)
              } yield {
                val nmls = NMLService.extractFromFile(nmlFile.ref.file, nmlFile.filename)
                val project = Project.findOneByName(projectName)
                val baseTask = Task(
                  0,
                  taskType._id,
                  experience,
                  priority,
                  instances,
                  _project = project.map(_.name))
                nmls.foreach {
                  nml =>
                    val task = Task.copyDeepAndInsert(baseTask)
                    AnnotationDAO.createAnnotationBase(task, new ObjectId(request.user._id.stringify), task.settings, nml)
                }
                Redirect(routes.TaskAdministration.list).flashing(
                  FlashSuccess(Messages("task.bulk.createSuccess", nmls.size)))
              })
        })
      }
  }

  def createBulk = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
      for {
        data <- postParameter("data") ?~ Messages("task.bulk.notSupplied")
      } yield {
        val inserted = data
                       .split("\n")
                       .map(_.split(" ").map(_.trim))
                       .filter(_.length >= 9)
                       .flatMap {
          params =>
            for {
              experienceValue <- params(3).toIntOpt
              x <- params(4).toIntOpt
              y <- params(5).toIntOpt
              z <- params(6).toIntOpt
              priority <- params(7).toIntOpt
              instances <- params(8).toIntOpt
              taskTypeSummary = params(1)
              taskType <- TaskType.findOneBySumnary(taskTypeSummary)
            } yield {
              val project = if (params.length >= 10) Project.findOneByName(params(9)).map(_.name) else None
              val dataSetName = params(0)
              val experience = Experience(params(2), experienceValue)
              val task = Task.insertOne(Task(
                0,
                taskType._id,
                experience,
                priority,
                instances,
                _project = project))
              AnnotationDAO.createAnnotationBase(task, new ObjectId(request.user._id.stringify), task.settings, dataSetName, Point3D(x, y, z))
              task
            }
        }
        Redirect(routes.TaskAdministration.list)
        .flashing(
          FlashSuccess(Messages("task.bulk.createSuccess", inserted.size.toString)))
      }
  }

  def tasksForProject(projectName: String) = Authenticated {
    implicit request =>
      for {
        project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
      } yield {
        val result = project.tasks.foldLeft(Html.empty) {
          case (h, e) => h += html.admin.task.simpleTask(e)
        }
        Ok(result)
      }
  }

  def tasksForType(taskTypeId: String) = Authenticated {
    implicit request =>
      for {
        taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
      } yield {
        val result = Task.findAllByTaskType(taskType).foldLeft(Html.empty) {
          case (h, e) => h += html.admin.task.simpleTask(e)
        }
        Ok(result)
      }
  }

  def overview = Authenticated {
    implicit request =>
      Async {
        def combineUsersWithTasks(users: List[User]) = {
          for {
            user <- users
            annotation <- AnnotationService.openTasksFor(user)
            task <- annotation.task
            taskType <- task.taskType
          } yield (user -> taskType)
        }

        for {
          users <- UserService.findAll
          allTaskTypes = TaskType.findAll
          usersWithTasks = combineUsersWithTasks(users)
          futureTasks <- TaskService.simulateTaskAssignment(users)
        } yield {
          val futureTaskTypes = futureTasks.flatMap(e => e._2.taskType.map(e._1 -> _))
          Ok(html.admin.task.taskOverview(users, allTaskTypes, usersWithTasks.distinct, futureTaskTypes))
        }
      }
  }
}