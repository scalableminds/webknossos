package controllers.admin

import braingames.mvc.Controller
import play.mvc.Security.Authenticated
import oxalis.security.Secured
import models.security.Role
import oxalis.annotation._
import views._
import models.task.TaskType
import play.api.data.Forms._
import play.api.data.Form
import models.task.TimeSpan
import play.api.i18n.Messages
import models.task.Task
import models.tracing._
import play.api.templates.Html
import controllers.Application
import models.annotation.AnnotationDAO

object TaskTypeAdministration extends Controller with Secured{

  override val DefaultAccessRole = Role.Admin

  val taskTypeForm = Form(
    mapping(
      "summary" -> nonEmptyText(2, 50),
      "description" -> text,
      "allowedModes" -> seq(text).verifying("taskType.emptyModeSelection", l => !l.isEmpty),
      "branchPointsAllowed" -> boolean,
      "somaClickingAllowed" -> boolean,
      "expectedTime" -> mapping(
        "minTime" -> number,
        "maxTime" -> number,
        "maxHard" -> number)(TimeSpan.apply)(TimeSpan.unapply))(
        TaskType.fromForm)(TaskType.toForm)).fill(TaskType.empty)
  
  def create = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    taskTypeForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.admin.taskType.taskTypes(TaskType.findAll, formWithErrors)),
      { t =>
        TaskType.insertOne(t)
        Redirect(routes.TaskTypeAdministration.list)
          .flashing(
            FlashSuccess(Messages("taskType.createSuccess")))
          .highlighting(t.id)
      })
  }


  def list = Authenticated { implicit request =>
    Ok(html.admin.taskType.taskTypes(TaskType.findAll, taskTypeForm))
  }

  def edit(taskTypeId: String) = Authenticated { implicit request =>
    for {
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
    } yield {
      Ok(html.admin.taskType.taskTypeEdit(taskType.id, taskTypeForm.fill(taskType)))
    }
  }

  def editTaskTypeForm(taskTypeId: String) = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
    } yield {
      taskTypeForm.bindFromRequest.fold(
        formWithErrors => BadRequest(html.admin.taskType.taskTypeEdit(taskType.id, formWithErrors)),
        { t =>
          val updatedTaskType = t.copy(_id = taskType._id)
          TaskType.save(updatedTaskType)
          Task.findAllByTaskType(taskType).map { task =>
            AnnotationDAO.updateAllUsingNewTaskType(task, updatedTaskType)
          }
          Redirect(routes.TaskTypeAdministration.list)
            .flashing(
              FlashSuccess(Messages("taskType.editSuccess")))
            .highlighting(taskType.id)
        })
    }
  }

  def delete(taskTypeId: String) = Authenticated { implicit request =>
    for {
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
    } yield {
      TaskType.removeById(taskType._id)
      JsonOk(Messages("taskType.deleted", taskType.summary))
    }
  }
}