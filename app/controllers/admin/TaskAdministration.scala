package controllers.admin

import play.api.mvc.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.user.User
import models.task._
import models.binary.DataSet
import controllers.Application
import brainflight.mail.Send
import brainflight.mail.DefaultMails
import brainflight.tools.ExtendedTypes._
import models.security.Role
import play.api.data._
import play.api.data.Forms._

object TaskAdministration extends Controller with Secured {

  val taskTypeForm = Form(
    mapping(
      "summary" -> nonEmptyText(2, 50),
      "description" -> text,
      "expectedTime" -> mapping(
        "minTime" -> number,
        "maxTime" -> number,
        "maxHard" -> number)(TimeSpan.apply)(TimeSpan.unapply))(
        TaskType.fromForm)(TaskType.toForm)).fill(TaskType.empty)

  val taskForm = Form(
    mapping(
      "experiment" -> text.verifying("experiment.invalid", experiment => Experiment.findOneById(experiment).isDefined),
      "taskType" -> text.verifying("taskType.invalid", task => TaskType.findOneById(task).isDefined),
      "priority" -> number,
      "taskInstances" -> number)(Task.fromForm)(Task.toForm)).fill(Task.empty)

  override val DefaultAccessRole = Role("admin")

  def bulkCreate = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    request.request.body.get("data").flatMap(_.headOption).map{ data =>
      data
      .split("\n")
      .map(_.split(" "))
      .filter(_.size != 11)
      .map{ params =>
        for{
          cellId <- params(1).toIntOpt
          startX <- params(3).toIntOpt
          startY <- params(4).toIntOpt
          startZ <- params(5).toIntOpt
          priority <- params(6).toIntOpt
          instances <- params(7).toIntOpt
        } yield 0//Task()
      }
      Ok
    } getOrElse BadRequest("'data' parameter is mising")
  }

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.taskList(request.user, Task.findAll))
  }

  def types = Authenticated { implicit request =>
    Ok(html.admin.task.taskTypes(request.user, TaskType.findAll, taskTypeForm))
  }

  def create = Authenticated { implicit request =>
    Ok(html.admin.task.taskCreate(request.user, Experiment.findAllTemporary, TaskType.findAll, taskForm))
  }

  def createType = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskTypeForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.admin.task.taskTypes(request.user, TaskType.findAll, formWithErrors)),
      { t =>
        TaskType.insert(t)
        Ok(html.admin.task.taskTypes(request.user, TaskType.findAll, taskTypeForm))
      })
  }

  def createFromExperiment = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.admin.task.taskCreate(request.user, Experiment.findAllTemporary, TaskType.findAll, formWithErrors)),
      { t =>
        Task.insert(t)
        Ok(t.toString)
      })
  }
}