package controllers.admin

import scala.Array.canBuildFrom
import scala.Option.option2Iterable
import brainflight.security.AuthenticatedRequest
import brainflight.security.Secured
import brainflight.tools.ExtendedTypes.String2ExtendedString
import brainflight.tools.geometry.Point3D
import models.binary.DataSet
import models.security.Role
import models.tracing._
import models.task.Task
import models.user.User
import models.task.TaskType
import play.api.data.Form
import play.api.data.Forms.mapping
import play.api.data.Forms.number
import play.api.data.Forms.text
import views.html
import models.user.Experience
import controllers.Controller
import play.api.i18n.Messages

object TaskAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  val taskFromTracingForm = Form(
    mapping(
      "tracing" -> text.verifying("tracing.invalid", tracing => Tracing.findOneById(tracing).isDefined),
      "taskType" -> text.verifying("taskType.invalid", task => TaskType.findOneById(task).isDefined),
      "experience" -> mapping(
        "domain" -> text,
        "value" -> number)(Experience.apply)(Experience.unapply),
      "priority" -> number,
      "taskInstances" -> number)(Task.fromTracingForm)(Task.toTracingForm)).fill(Task.empty)

  val taskMapping = mapping(
    "dataSet" -> text.verifying("dataSet.invalid", name => DataSet.findOneByName(name).isDefined),
    "taskType" -> text.verifying("taskType.invalid", task => TaskType.findOneById(task).isDefined),
    "start" -> mapping(
      "point" -> text.verifying("point.invalid", p => p.matches("([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*")))(Point3D.fromForm)(Point3D.toForm),
    "experience" -> mapping(
      "domain" -> text,
      "value" -> number)(Experience.apply)(Experience.unapply),
    "priority" -> number,
    "taskInstances" -> number)(Task.fromForm)(Task.toForm)

  val taskForm = Form(
    taskMapping).fill(Task.empty)

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.taskList(Task.findAllNonTrainings))
  }

  def taskCreateHTML(tracingForm: Form[models.task.Task], taskForm: Form[models.task.Task])(implicit request: AuthenticatedRequest[_]) =
    html.admin.task.taskCreate(
      Tracing.findAllExploratory(request.user),
      TaskType.findAll,
      DataSet.findAll,
      Experience.findAllDomains,
      tracingForm,
      taskForm)

  def create = Authenticated { implicit request =>
    Ok(taskCreateHTML(taskForm, taskFromTracingForm))
  }

  def delete(taskId: String) = Authenticated { implicit request =>
    Task.findOneById(taskId).map { task =>
      Task.remove(task)
      AjaxOk.success(Messages("task.removed"))
    } getOrElse AjaxBadRequest.error("Task couldn't get removed (task not found)")

  }

  def createFromForm = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(taskCreateHTML(taskFromTracingForm, formWithErrors)),
      { t =>
        Task.insertOne(t)
        Redirect(routes.TaskAdministration.list)
      })
  }

  def createFromTracing = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskFromTracingForm.bindFromRequest.fold(
      formWithErrors => BadRequest(taskCreateHTML(formWithErrors, taskForm)),
      { t =>
        Task.insertOne(t)
        Redirect(routes.TaskAdministration.list).flashing(
            FlashSuccess(Messages("task.create.success")))
      })
  }
  

  def createBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    request.request.body.get("data").flatMap(_.headOption).map { data =>
      val inserted = data
        .split("\n")
        .map(_.split(" "))
        .filter(_.size == 9)
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
            val dataSetName = params(0)
            val experience = Experience(params(2), experienceValue)
            Task(dataSetName, 0, taskType._id, Point3D(x, y, z), experience, priority, instances)
          }
        }
        .map { t =>
          Task.insertOne(t)
        }
      Redirect(routes.TaskAdministration.list)
    } getOrElse BadRequest("'data' parameter is mising")
  }
  
  def overview =  Authenticated { implicit request =>
    val taskLessUsers = User.findAll.filter(user => !Tracing.hasOpenTracing(user, false))
    val usersWithTasks =Tracing.findAllOpen(TracingType.Task).flatMap{ tracing => 
      tracing.task.flatMap( task => tracing.user.map(_ -> task))
    }.toMap
    Ok(html.admin.task.taskOverview(taskLessUsers, usersWithTasks, Map.empty))
  }
}