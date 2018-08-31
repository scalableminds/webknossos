package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationSettings
import models.task._
import models.user.UserService
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import utils.ObjectId

class TaskTypeController @Inject()(taskTypeDAO: TaskTypeDAO,
                                   taskDAO: TaskDAO,
                                   taskTypeService: TaskTypeService,
                                   userService: UserService,
                                   val messagesApi: MessagesApi) extends Controller with FoxImplicits{

  val taskTypePublicReads =
    ((__ \ 'summary).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'description).read[String] and
      (__ \ 'teamId).read[String] (ObjectId.stringObjectIdReads("teamId")) and
      (__ \ 'settings).read[AnnotationSettings]) (taskTypeService.fromForm _)

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { taskType =>
      for {
        _ <- userService.isTeamManagerOrAdminOf(request.identity, taskType._team)
        _ <- taskTypeDAO.insertOne(taskType)
        js <- taskTypeService.publicWrites(taskType)
      } yield Ok(js)
    }
  }

  def get(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
      _ <- userService.isTeamManagerOrAdminOf(request.identity, taskType._team)
      js <- taskTypeService.publicWrites(taskType)
    } yield Ok(js)
  }

  def list = SecuredAction.async { implicit request =>
    for {
      taskTypes <- taskTypeDAO.findAll
      js <- Fox.serialCombined(taskTypes)(t => taskTypeService.publicWrites(t))
    } yield Ok(Json.toJson(js))
  }

  def update(taskTypeId: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { taskTypeFromForm =>
      for {
        taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
        updatedTaskType = taskTypeFromForm.copy(_id = taskType._id)
        _ <- userService.isTeamManagerOrAdminOf(request.identity, taskType._team)
        _ <- userService.isTeamManagerOrAdminOf(request.identity, updatedTaskType._team)
        _ <- taskTypeDAO.updateOne(updatedTaskType)
        js <- taskTypeService.publicWrites(updatedTaskType)
      } yield {
        JsonOk(js, Messages("taskType.editSuccess"))
      }
    }
  }

  def delete(taskTypeId: String) = SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound"
      _ <- userService.isTeamManagerOrAdminOf(request.identity, taskType._team)
      _ <- taskTypeDAO.deleteOne(taskTypeIdValidated) ?~> "taskType.deleteFailure"
      _ <- taskDAO.removeAllWithTaskTypeAndItsAnnotations(taskTypeIdValidated) ?~> "taskType.deleteFailure"
    } yield {
      JsonOk(Messages("taskType.deleteSuccess", taskType.summary))
    }
  }
}
