package controllers.admin

import controllers.Controller
import play.api.mvc.Action
import brainflight.security.Secured
import views.html
import models.user.User
import controllers.Application
import brainflight.mail.Send
import brainflight.mail.DefaultMails
import models.security.Role
import play.api.libs.json.Json
import play.api.templates.Html
import play.api.i18n.Messages
import brainflight.security.AuthenticatedRequest

object UserAdministration extends Controller with Secured {
  override val DefaultAccessRole = Role("admin")

  def index = Authenticated { implicit request =>
    Ok(html.admin.user.userAdministration(request.user, User.findAll.sortBy(_.lastName)))
  }

  def bulkOperation(operation: String => Option[User])(successMessage: User => String, errorMessage: String => String)(implicit request: AuthenticatedRequest[Map[String, Seq[String]]]) = {
    request.body.get("id") match {
      case Some(ids) =>
        val results = ids.map { userId =>
          operation(userId) match {
            case Some(user) => ajaxSuccess -> successMessage(user)
            case _          => ajaxError -> errorMessage(userId)
          }
        }
        AjaxOk(html.admin.user.userTable(User.findAll), results)
      case _ =>
        BadRequest("Id parameter is missing.")
    }
  }

  private def verifyUser(userId: String) = {
    User.findOneById(userId) map { user =>
      Application.Mailer ! Send(DefaultMails.verifiedMail(user.name, user.email))
      User.verify(user)
    }
  }

  def verify(userId: String) = Authenticated { implicit request =>
    verifyUser(userId) map { user =>
      AjaxOk.success(html.admin.user.userTableItem(user), user.name + Messages("user.verified"))
    } getOrElse
      BadRequest
  }

  def verifyBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    bulkOperation(verifyUser)(
      user => "Verified %s".format(user.name),
      userId => "Couldn't verify user with id '%s'".format(userId))
  }

  def deleteUser(userId: String) = {
    User.findOneById(userId) map { user =>
      User.remove(user)
      user
    }
  }

  def delete(userId: String) = Authenticated { implicit request =>
    deleteUser(userId) map { user =>
      AjaxOk.success(user.name + Messages("user.deleted"))
    } getOrElse BadRequest
  }

  def deleteBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    bulkOperation(deleteUser)(
      user => "Deleted %s".format(user.name),
      userId => "Couldn't delete user with id '%s'".format(userId))
  }
}