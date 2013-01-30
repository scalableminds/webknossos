package controllers.admin

import scala.Array.canBuildFrom
import scala.Option.option2Iterable
import brainflight.security.AuthenticatedRequest
import brainflight.security.Secured
import braingames.util.ExtendedTypes.ExtendedString
import brainflight.tools.geometry.Point3D
import models.binary.DataSet
import models.security.Role
import models.tracing._
import models.task.Task
import models.user.User
import models.task.TaskType
import play.api.data.Form
import play.api.data.Forms._
import views.html
import models.user.Experience
import braingames.mvc.Controller
import play.api.i18n.Messages
import play.api.libs.concurrent._
import play.api.libs.concurrent.Execution.Implicits._
import java.lang.Cloneable
import models.task.Project
import play.api.Logger

object TaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  val taskFromNMLForm = Form(
    tuple(
      "taskType" -> text.verifying("taskType.notFound",
        taskType => TaskType.findOneById(taskType).isDefined),
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.apply)(Experience.unapply),
      "priority" -> number,
      "taskInstances" -> number,
      "project" -> text.verifying("project.notFound",
        project => project == "" || Project.findOneByName(project).isDefined)))

  val taskMapping = tuple(
    "dataSet" -> text.verifying("dataSet.notFound",
      name => DataSet.findOneByName(name).isDefined),
    "taskType" -> text.verifying("taskType.notFound",
      task => TaskType.findOneById(task).isDefined),
    "start" -> mapping(
      "point" -> text.verifying("point.invalid",
        p => p.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(Point3D.fromForm)(Point3D.toForm),
    "experience" -> mapping(
      "domain" -> text,
      "value" -> number)(Experience.apply)(Experience.unapply),
    "priority" -> number,
    "taskInstances" -> number,
    "project" -> text.verifying("project.notFound",
      project => project == "" || Project.findOneByName(project).isDefined))

  val taskForm = Form(
    taskMapping)

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.taskList(Task.findAllNonTrainings))
  }

  def taskCreateHTML(
    taskFromNMLForm: Form[(String, Experience, Int, Int, String)],
    taskForm: Form[(String, String, Point3D, Experience, Int, Int, String)])(implicit request: AuthenticatedRequest[_]) =
    html.admin.task.taskCreate(
      TaskType.findAll,
      DataSet.findAll,
      Experience.findAllDomains,
      taskFromNMLForm,
      taskForm)

  def create = Authenticated { implicit request =>
    Ok(taskCreateHTML(taskFromNMLForm, taskForm))
  }

  def delete(taskId: String) = Authenticated { implicit request =>
    for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
    } yield {
      Task.remove(task)
      JsonOk(Messages("task.removed"))
    }
  }
  
  def cancelTracing(tracingId: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
    } yield {
      UsedTracings.removeAll(tracing)
      tracing match {
        case t if t.tracingType == TracingType.Task =>
          tracing.update(_.cancel)
          JsonOk(Messages("task.cancelled"))
      }
    }
  }

  def createFromForm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(taskCreateHTML(taskFromNMLForm, formWithErrors)),
      {
        case (dataSetName, taskTypeId, start, experience, priority, instances, projectName) =>
          for {
            taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
          } yield {
            val project = Project.findOneByName(projectName)
            val task = Task.insertOne(Task(
              0,
              taskType._id,
              experience,
              priority,
              instances,
              _project = project.map(_.name)))
            Tracing.createTracingBase(task, request.user._id, dataSetName, start)
            Redirect(routes.TaskAdministration.list).flashing(
              FlashSuccess(Messages("task.createSuccess")))
          }
      })
  }

  def createFromNML = Authenticated(parser = parse.multipartFormData) { implicit request =>
    taskFromNMLForm.bindFromRequest.fold(
      formWithErrors => BadRequest(taskCreateHTML(formWithErrors, taskForm)),
      {
        case (taskTypeId, experience, priority, instances, projectName) =>
          for {
            nmlFile <- request.body.file("nmlFile") ?~ Messages("nml.file.notFound")
            taskType <- TaskType.findOneById(taskTypeId)
          } yield {
            val nmls = NMLIO.extractFromFile(nmlFile.ref.file, nmlFile.filename)
            val project = Project.findOneByName(projectName)
            val baseTask = Task(
              0,
              taskType._id,
              experience,
              priority,
              instances,
              _project = project.map(_.name))
            nmls.foreach { nml =>
              val task = Task.createAndInsertDeepCopy(baseTask)
              Tracing.createTracingBase(task, request.user._id, nml)
            }
            Redirect(routes.TaskAdministration.list).flashing(
              FlashSuccess(Messages("task.bulk.createSuccess", nmls.size)))
          }
      })
  }

  def createBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      data <- postParameter("data") ?~ Messages("task.bulk.notSupplied")
    } yield {
      val inserted = data
        .split("\n")
        .map(_.split(" "))
        .filter(_.size >= 8)
        .flatMap { params =>
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
            val project = if (params.size >= 9) Project.findOneByName(params(9)).map(_.name) else None
            val dataSetName = params(0)
            val experience = Experience(params(2), experienceValue)
            val task = Task.insertOne(Task(
              0,
              taskType._id,
              experience,
              priority,
              instances,
              _project = project))
            Tracing.createTracingBase(task, request.user._id, dataSetName, Point3D(x, y, z))
            task
          }
        }
      Redirect(routes.TaskAdministration.list).flashing(
        FlashSuccess(Messages("task.bulk.createSuccess", inserted.size.toString)))
    }
  }

  def overview = Authenticated { implicit request =>
    Async {
      play.api.templates.Html
      val allUsers = User.findAll
      val allTaskTypes = TaskType.findAll
      val usersWithoutTask = allUsers.filter(user => !Tracing.hasOpenTracing(user, TracingType.Task))
      val usersWithTasks =
        (for {
          user <- allUsers
          tracing <- Tracing.findOpenTracingsFor(user, TracingType.Task)
          task <- tracing.task
          taskType <- task.taskType
        } yield (user -> taskType)).toMap

      Task.simulateTaskAssignment(allUsers).map { futureTasks =>
        val futureTaskTypes = futureTasks.flatMap(e => e._2.taskType.map(e._1 -> _))
        Ok(html.admin.task.taskOverview(allUsers, allTaskTypes, usersWithTasks, futureTaskTypes))
      }
    }
  }
}