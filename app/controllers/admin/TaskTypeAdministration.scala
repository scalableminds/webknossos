package controllers.admin

import play.mvc.Security.Authenticated
import oxalis.security.{AuthenticatedRequest, Secured}
import oxalis.annotation._
import views._
import models.task._
import play.api.data.Forms._
import play.api.data.Form
import play.api.i18n.Messages
import models.tracing._
import play.api.templates.Html
import controllers.{Controller, Application}
import models.annotation.AnnotationDAO
import play.api.libs.concurrent.Execution.Implicits._
import braingames.util.Fox
import play.api.mvc.SimpleResult

object TaskTypeAdministration extends AdminController {

  val taskTypeForm = Form(
    mapping(
      "summary" -> nonEmptyText(2, 50),
      "description" -> text,
      "team" -> nonEmptyText,
      "allowedModes" -> seq(text).verifying("taskType.emptyModeSelection", l => !l.isEmpty),
      "branchPointsAllowed" -> boolean,
      "somaClickingAllowed" -> boolean,
      "expectedTime" -> mapping(
        "minTime" -> number,
        "maxTime" -> number,
        "maxHard" -> number)(TimeSpan.apply)(TimeSpan.unapply))(
      TaskType.fromForm)(TaskType.toForm)).fill(TaskType.empty)

  def create = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    taskTypeForm.bindFromRequest.fold(
      hasErrors = formWithErrors => taskTypeListWithForm(formWithErrors).map(html => BadRequest(html)),
      success = { t =>
        for{
          _ <- ensureTeamAdministration(request.user, t.team).toFox
          _ <- TaskTypeDAO.insert(t)
        } yield {
          Redirect(routes.TaskTypeAdministration.list)
          .flashing(
            FlashSuccess(Messages("taskType.createSuccess")))
          .highlighting(t.id)
        }
      })
  }

  def taskTypeListWithForm(form: Form[TaskType])(implicit request: AuthenticatedRequest[_]) = {
    TaskTypeDAO.findAll.map { taskTypes =>
      html.admin.taskType.taskTypes(taskTypes, form, request.user.adminTeamNames)
    }
  }

  def list = Authenticated.async { implicit request =>
    taskTypeListWithForm(taskTypeForm).map { html =>
      Ok(html)
    }
  }

  def edit(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team)
    } yield {
      Ok(html.admin.taskType.taskTypeEdit(taskType.id, taskTypeForm.fill(taskType), request.user.adminTeamNames))
    }
  }

  def editTaskTypeForm(taskTypeId: String) = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    def evaluateForm(taskType: TaskType): Fox[SimpleResult] = {
      taskTypeForm.bindFromRequest.fold(
        hasErrors = (errors => Fox.successful(BadRequest(html.admin.taskType.taskTypeEdit(taskType.id, errors, request.user.adminTeamNames)))),
        success = { t =>
          val updatedTaskType = t.copy(_id = taskType._id)
          for {
            _ <- TaskTypeDAO.update(taskType._id, updatedTaskType).toFox
            tasks <- TaskDAO.findAllByTaskType(taskType).toFox
            _ <- ensureTeamAdministration(request.user, updatedTaskType.team).toFox
          } yield {
            tasks.map(task => AnnotationDAO.updateAllUsingNewTaskType(task, updatedTaskType.settings))
            Redirect(routes.TaskTypeAdministration.list)
            .flashing(
              FlashSuccess(Messages("taskType.editSuccess")))
            .highlighting(taskType.id)
          }
        })
    }

    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team).toFox
      result <- evaluateForm(taskType)
    } yield {
      result
    }
  }

  def delete(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team)
    } yield {
      TaskTypeDAO.removeById(taskType._id)
      JsonOk(Messages("taskType.deleted", taskType.summary))
    }
  }
}