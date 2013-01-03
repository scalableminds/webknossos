package controllers.admin

import controllers.Controller
import play.mvc.Security.Authenticated
import brainflight.security.Secured
import models.security.Role
import views._
import models.task.TaskType
import play.api.data.Forms._
import play.api.data.Form
import models.task.TimeSpan
import play.api.i18n.Messages

object TaskTypeAdministration extends Controller with Secured {
  //finished localization
  override val DefaultAccessRole = Role.Admin

  val taskTypeForm = Form(
    mapping(
      "summary" -> nonEmptyText(2, 50),
      "description" -> text,
      "expectedTime" -> mapping(
        "minTime" -> number,
        "maxTime" -> number,
        "maxHard" -> number)(TimeSpan.apply)(TimeSpan.unapply))(
        TaskType.fromForm)(TaskType.toForm)).fill(TaskType.empty)

  def list = Authenticated { implicit request =>
    Ok(html.admin.task.taskTypes(TaskType.findAll, taskTypeForm))
  }

  def create = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskTypeForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.admin.task.taskTypes(TaskType.findAll, formWithErrors)),
      { t =>
        TaskType.insertOne(t)
        Ok(html.admin.task.taskTypes(TaskType.findAll, taskTypeForm))
      })
  }
  
  def delete(taskTypeId: String) = Authenticated { implicit request =>
    for{
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
    } yield {
      TaskType.remove(taskType)
      JsonOk(Messages("taskType.deleted", taskType.summary))
    }
  }
}