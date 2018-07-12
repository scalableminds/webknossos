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
import utils.ObjectId

class TaskTypeController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits{

  val taskTypePublicReads =
    ((__ \ 'summary).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'description).read[String] and
      (__ \ 'team).read[String] (ObjectId.stringBSONObjectIdReads("team")) and
      (__ \ 'settings).read[AnnotationSettings]) (TaskType.fromForm _)

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { taskType =>
      for {
        _ <- ensureTeamAdministration(request.identity, taskType._team)
        _ <- TaskTypeDAO.insert(taskType)
      } yield {
        JsonOk(TaskType.transformToJson(taskType))
      }
    }
  }

  def get(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.identity, taskType._team)
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
        _ <- ensureTeamAdministration(request.identity, taskType._team)
        _ <- ensureTeamAdministration(request.identity, updatedTaskType._team)
        _ <- TaskTypeDAO.update(taskType._id, updatedTaskType)
      } yield {
        JsonOk(TaskType.transformToJson(updatedTaskType), Messages("taskType.editSuccess"))
      }
    }
  }

  def delete(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.identity, taskType._team)
      _ <- TaskTypeDAO.removeById(taskType._id) ?~> Messages("taskType.deleteFailure")
      _ <- TaskSQLDAO.removeAllWithTaskTypeAndItsAnnotations(ObjectId.fromBsonId(taskType._id)) ?~> Messages("taskType.deleteFailure")
    } yield {
      JsonOk(Messages("taskType.deleteSuccess", taskType.summary))
    }
  }
}
