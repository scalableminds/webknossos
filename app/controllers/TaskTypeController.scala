package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationSettings}
import models.task._
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import play.twirl.api.Html

class TaskTypeController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits{

  val taskTypePublicReads =
    ((__ \ 'summary).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'description).read[String] and
      (__ \ 'team).read[String] and
      (__ \ 'settings).read[AnnotationSettings] and
      (__ \ 'expectedTime).read[TraceLimit]) (TaskType.fromForm _)

  def empty(id: String) = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def create = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { taskType =>
      for {
        _ <- ensureTeamAdministration(request.user, taskType.team)
        _ <- TaskTypeDAO.insert(taskType)
      } yield {
        JsonOk(TaskType.transformToJson(taskType))
      }
    }
  }

  def get(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team)
    } yield {
      JsonOk(TaskType.transformToJson(taskType))
    }
  }


  def list = Authenticated.async { implicit request =>
    for {
      taskTypes <- TaskTypeDAO.findAll
    } yield {
      Ok(Json.toJson(taskTypes.map(TaskType.transformToJson)))
    }
  }

  def update(taskTypeId: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { tt =>
      for {
        taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
        updatedTaskType = tt.copy(_id = taskType._id)
        _ <- ensureTeamAdministration(request.user, taskType.team)
        _ <- ensureTeamAdministration(request.user, updatedTaskType.team)
        _ <- TaskTypeDAO.update(taskType._id, updatedTaskType)
        tasks <- TaskDAO.findAllByTaskType(taskType._id)
        _ <- Fox.serialSequence(tasks)(task => AnnotationDAO.updateAllOfTask(task, updatedTaskType.settings))
      } yield {
        JsonOk(TaskType.transformToJson(updatedTaskType), Messages("taskType.editSuccess"))
      }
    }
  }

  def delete(taskTypeId: String) = Authenticated.async { implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team)
      updatedTaskType = taskType.copy(isActive = false)
      _ <- TaskTypeDAO.update(taskType._id, updatedTaskType) ?~> Messages("taskType.deleteFailure")
    } yield {
      TaskService.removeAllWithTaskType(taskType)
      JsonOk(Messages("taskType.deleteSuccess", taskType.summary))
    }
  }
}
