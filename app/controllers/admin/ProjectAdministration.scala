package controllers.admin

import scala.concurrent.duration._
import views._
import models.task.{ProjectService, ProjectDAO, Project}
import play.api.data.Form._
import play.api.data.Form
import play.api.data.Forms._
import models.user.{UserService, User}
import play.api.i18n.Messages
import play.api.templates.Html
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._

import play.api.mvc.Request
import oxalis.security.AuthenticatedRequest
import scala.concurrent.Future
import play.api.libs.json.{Json, JsObject, JsArray}

object ProjectAdministration extends AdminController {

  val projectForm = Form(tuple(
    "projectName" -> nonEmptyText(1, 100),
    "owner" -> nonEmptyText(1, 100)))

  def sortedUsers(implicit ctx: DBAccessContext) = UserService.findAll.map(_.sortBy(_.name))

  def projectListWithForm(form: Form[(String, String)])(implicit request: AuthenticatedRequest[_]) =
    for {
      users <- sortedUsers
      projects <- ProjectDAO.findAll
    } yield {
      html.admin.project.projectList()
    }

  def list = Authenticated().async { implicit request =>
    render.async {
      case Accepts.Html() =>
        Future.successful(Ok(html.admin.project.projectList()))
      case Accepts.Json() =>
        for {
          projects <- ProjectDAO.findAll
          users <- sortedUsers
        } yield {
          JsonOk(Json.obj("projects" -> projects, "users" -> users))
        }
    }
  }

  def delete(projectName: String) = Authenticated().async { implicit request =>
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound")
    } yield {
      ProjectService.remove(project)
      JsonOk(Messages("project.removed"))
    }
  }

  def create = Authenticated().async(parse.urlFormEncoded) { implicit request =>
    projectForm.bindFromRequest.fold(
    formWithErrors =>
      for {
        html <- projectListWithForm(formWithErrors)
      } yield {
        BadRequest(html)
      }, {
      case (name, ownerId) =>
        ProjectDAO.findOneByName(name).flatMap {
          case Some(_) =>
            for {
              html <- projectListWithForm(projectForm.bindFromRequest.withError("projectName", Messages("project.nameAlreadyInUse")))
            } yield {
              BadRequest(html)
            }
          case _ => {
            for {
              owner <- UserService.findOneById(ownerId, useCache = true) ?~> Messages("user.notFound")
            } yield {
              ProjectService.insert(name, owner)
              Redirect(routes.ProjectAdministration.list).flashing(
                FlashSuccess(Messages("project.createSuccess")))
            }
          }
        }

    })
  }
}
