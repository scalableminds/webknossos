package controllers.admin

import javax.inject.Inject

import models.task._
import play.api.data.Forms._
import play.api.data.Form
import play.api.i18n.{MessagesApi, Messages}
import play.twirl.api.Html
import models.annotation.AnnotationDAO
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.Fox
import play.api.mvc.Result
import scala.concurrent.Future
import play.api.libs.json._

class TaskTypeAdministration @Inject() (val messagesApi: MessagesApi) extends AdminController {

  val taskTypeForm = Form(
    mapping(
      "summary" -> nonEmptyText(2, 50),
      "description" -> text,
      "team" -> nonEmptyText,
      "allowedModes" -> seq(text),
      "preferredMode" -> optional(text),
      "branchPointsAllowed" -> boolean,
      "advancedOptionsAllowed" -> boolean,
      "somaClickingAllowed" -> boolean,
      "expectedTime" -> mapping(
        "minTime" -> number(min = 1),
        "maxTime" -> number(min = 1),
        "maxHard" -> number(min = 1))(TraceLimit.apply)(TraceLimit.unapply))(
      TaskType.fromForm)(TaskType.toForm)).fill(TaskType.empty)

  def empty(id: String) = Authenticated{ implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def create = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    val boundForm = taskTypeForm.bindFromRequest

    boundForm.fold(
      hasErrors = { formWithErrors =>
        Future.successful(JsonBadRequest(
          Json.obj("errors" -> boundForm.errorsAsJson),
          Messages("Incomplete form.")
        ))
      },

      success = { t =>
        for{
          _ <- ensureTeamAdministration(request.user, t.team)
          _ <- TaskTypeDAO.insert(t)
        } yield {
          JsonOk(
            Json.obj("newTaskType" -> TaskType.transformToJson(t)),
            Messages("taskType.createSuccess")
          )
        }
      })
  }

  def get(taskTypeId: String) = Authenticated.async{ implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team)
      ttJson <- TaskType.transformToJsonWithStatus(taskType)
    } yield {
      Ok(ttJson)
    }
  }


  def list = Authenticated.async{ implicit request =>
    for {
      taskTypes <- TaskTypeDAO.findAll
    } yield {
      Ok(Json.toJson(taskTypes.map(TaskType.transformToJson)))
    }
  }

  def editTaskTypeForm(taskTypeId: String) = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    def evaluateForm(taskType: TaskType): Fox[Result] = {
      val boundForm = taskTypeForm.bindFromRequest
      boundForm.fold(
        hasErrors = { formWithErrors =>
          Future.successful(JsonBadRequest(
            Json.obj("errors" -> boundForm.errorsAsJson),
            Messages("Incomplete form.")
          ))
        },
        success = { t =>
          val updatedTaskType = t.copy(_id = taskType._id)
          for {
            _ <- ensureTeamAdministration(request.user, updatedTaskType.team).toFox
            _ <- TaskTypeDAO.update(taskType._id, updatedTaskType)
            tasks <- TaskDAO.findAllByTaskType(taskType._id)
          } yield {
            tasks.map(task => AnnotationDAO.updateAllOfTask(task, updatedTaskType.settings))
            JsonOk(Messages("taskType.editSuccess"))
          }
        }
      )
    }

    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team)
      result <- evaluateForm(taskType)
    } yield {
      result
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
