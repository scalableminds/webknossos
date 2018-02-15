package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.FoxImplicits
import models.annotation.AnnotationSettings
import models.task._
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._

class TaskTypeController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits{

  val taskTypePublicReads =
    ((__ \ 'summary).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'description).read[String] and
      (__ \ 'team).read[String] and
      (__ \ 'settings).read[AnnotationSettings]) (TaskType.fromForm _)

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { taskType =>
      for {
        _ <- ensureTeamAdministration(request.identity, taskType.team)
        _ <- TaskTypeDAO.insert(taskType)
      } yield {
        JsonOk(TaskType.transformToJson(taskType))
      }
    }
  }

  def get(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.identity, taskType.team)
    } yield {
      JsonOk(TaskType.transformToJson(taskType))
    }
  }


  def list = SecuredAction.async { implicit request =>
    for {
      taskTypes <- TaskTypeDAO.findAll
    } yield {
      Ok(Json.toJson(taskTypes.map(TaskType.transformToJson)))
    }
  }

  def update(taskTypeId: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { tt =>
      for {
        taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
        updatedTaskType = tt.copy(_id = taskType._id)
        _ <- ensureTeamAdministration(request.identity, taskType.team)
        _ <- ensureTeamAdministration(request.identity, updatedTaskType.team)
        _ <- TaskTypeDAO.update(taskType._id, updatedTaskType)
        tasks <- TaskDAO.findAllByTaskType(taskType._id)
      } yield {
        JsonOk(TaskType.transformToJson(updatedTaskType), Messages("taskType.editSuccess"))
      }
    }
  }

  def delete(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.identity, taskType.team)
      _ <- TaskTypeDAO.removeById(taskType._id) ?~> Messages("taskType.deleteFailure")
    } yield {
      TaskService.removeAllWithTaskType(taskType)
      JsonOk(Messages("taskType.deleteSuccess", taskType.summary))
    }
  }
}
