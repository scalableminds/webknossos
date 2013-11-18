package controllers.admin

import scala.concurrent.duration._
import views._
import models.task.Project
import play.api.data.Form._
import play.api.data.Form
import play.api.data.Forms._
import models.user.{UserService, User}
import play.api.i18n.Messages
import play.api.templates.Html
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import org.bson.types.ObjectId

object ProjectAdministration extends AdminController {

  val projectForm = Form(tuple(
    "projectName" -> nonEmptyText(1, 100)
      .verifying("project.nameAlreadyInUse", name => Project.findOneByName(name).isEmpty),
    "owner" -> nonEmptyText(1, 100)))

  def sortedUsers(implicit ctx: DBAccessContext) = UserService.findAll.map(_.sortBy(_.name))

  def list = Authenticated {
    implicit request =>
      Async {
        sortedUsers.map {
          users =>
            Ok(html.admin.project.projectList(
              Project.findAll,
              projectForm.fill("", request.user.id),
              users))
        }
      }
  }

  def delete(projectName: String) = Authenticated {
    implicit request =>
      for {
        project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
      } yield {
        Project.remove(project)
        JsonOk(Messages("project.removed"))
      }
  }

  def create = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
      Async {
        projectForm.bindFromRequest.fold(
        formWithErrors =>
          sortedUsers.map {
            users =>
              BadRequest(html.admin.project.projectList(Project.findAll, formWithErrors, users))
          }, {
          case (name, ownerId) =>
            for {
              owner <- UserService.findOneById(ownerId, useCache = true) ?~> Messages("user.notFound")
            } yield {
              Project.insertOne(Project(name, new ObjectId(owner._id.stringify)))
              Redirect(routes.ProjectAdministration.list).flashing(
                FlashSuccess(Messages("project.createSuccess")))
            }
        })
      }
  }
}
