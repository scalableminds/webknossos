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
import com.scalableminds.util.tools.Fox
import play.api.mvc.SimpleResult
import scala.concurrent.Future
import play.api.libs.json._

object TaskTypeAdministration extends AdminController {

  val taskTypeForm = Form(
    mapping(
      "summary" -> nonEmptyText(2, 50),
      "description" -> text,
      "team" -> nonEmptyText,
      "allowedModes" -> seq(text),
      "branchPointsAllowed" -> boolean,
      "somaClickingAllowed" -> boolean,
      "expectedTime" -> mapping(
        "minTime" -> number,
        "maxTime" -> number,
        "maxHard" -> number)(TraceLimit.apply)(TraceLimit.unapply))(
      TaskType.fromForm)(TaskType.toForm)).fill(TaskType.empty)

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
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
          _ <- ensureTeamAdministration(request.user, t.team).toFox
          _ <- TaskTypeDAO.insert(t)
        } yield {
          JsonOk(
            Json.obj("newTaskType" -> TaskType.publicTaskTypeWrites.writes(t)),
            Messages("taskType.createSuccess")
          )
        }
      })
  }

  def get(taskTypeId: String) = Authenticated.async{ implicit request =>
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> Messages("taskType.notFound")
      _ <- ensureTeamAdministration(request.user, taskType.team)
    } yield {
      Ok(Json.toJson(TaskType.publicTaskTypeWrites.writes(taskType)))
    }
  }


  def list = Authenticated.async{ implicit request =>
    for {
      taskTypes <- TaskTypeDAO.findAll
    } yield {
      Ok(Json.toJson(taskTypes.map(TaskType.publicTaskTypeWrites.writes)))
    }
  }

  def editTaskTypeForm(taskTypeId: String) = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    def evaluateForm(taskType: TaskType): Fox[SimpleResult] = {
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
            _ <- TaskTypeDAO.update(taskType._id, updatedTaskType).toFox
            tasks <- TaskDAO.findAllByTaskType(taskType).toFox
            _ <- ensureTeamAdministration(request.user, updatedTaskType.team).toFox
          } yield {
            tasks.map(task => AnnotationDAO.updateAllUsingNewTaskType(task, updatedTaskType.settings))
            JsonOk(Messages("taskType.editSuccess"))
          }
        }
      )
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
