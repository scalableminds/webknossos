package controllers.admin

import scala.concurrent.duration._
import views._
import models.task.{ProjectService, ProjectDAO, Project, TaskService}
import controllers.admin.TaskAdministration
import play.api.Logger
import play.api.data.Form._
import play.api.data.Form
import play.api.data.Forms._
import models.user.{User, UserService}
import play.api.i18n.Messages
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._

import oxalis.security.AuthenticatedRequest
import scala.concurrent.Future
import play.api.libs.json._
import net.liftweb.common.Full

object ProjectAdministration extends AdminController {

  val projectForm = Form(tuple(
    "projectName" -> nonEmptyText(1, 100)
      .verifying("project.nameInvalid", name => name.matches("^[a-zA-Z0-9_-]*$")),
    "team" -> nonEmptyText(1, 100),
    "owner" -> nonEmptyText(1, 100)))

  def sortedUsers(implicit ctx: DBAccessContext) = UserService.findAll.map(_.sortBy(_.name))

  // TODO: remove form
  def projectListWithForm(form: Form[(String, String, String)])(implicit request: AuthenticatedRequest[_]) =
    Future.successful(html.admin.project.projectList(request.user.adminTeamNames))

  def list = Authenticated.async {
    implicit request =>
      render.async {
        case Accepts.Html() =>
          Future.successful(Ok(html.admin.project.projectList(request.user.adminTeamNames)))
        case Accepts.Json() =>
          for {
            projects <- ProjectDAO.findAll
            users <- sortedUsers
          } yield {
            JsonOk(Json.obj(
              "projects" -> projects,
              "users" -> users.map(u => Json.toJson(u)(User.userPublicWrites(request.user)))))
          }
      }
  }

  def delete(projectName: String) = Authenticated.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound")
        _ <- ProjectService.remove(project) ?~> Messages("project.remove.notAllowed")
      } yield {
        JsonOk(Messages("project.removed"))
      }
  }

  def create = Authenticated.async(parse.urlFormEncoded) {
    implicit request =>
      projectForm.bindFromRequest.fold(
      formWithErrors =>
        for {
          html <- projectListWithForm(formWithErrors)
        } yield {
          BadRequest(html)
        }, {
        case (name, team, ownerId) =>
          ProjectDAO.findOneByName(name).futureBox.flatMap {
            case Full(_) =>
              for {
                html <- projectListWithForm(projectForm.bindFromRequest.withError("projectName", Messages("project.nameAlreadyInUse")))
              } yield {
                BadRequest(html)
              }
            case _ if request.user.adminTeams.exists(_.team == team)=>
              for {
                owner <- UserService.findOneById(ownerId, useCache = true) ?~> Messages("user.notFound")
              } yield {
                ProjectService.insert(name, team, owner)
                Redirect(routes.ProjectAdministration.list).flashing(
                  FlashSuccess(Messages("project.createSuccess")))
              }
            case _ =>
              for {
                html <- projectListWithForm(projectForm.bindFromRequest.withError("team", Messages("team.notAllowed")))
              } yield {
                BadRequest(html)
              }
          }

      })
  }
}
