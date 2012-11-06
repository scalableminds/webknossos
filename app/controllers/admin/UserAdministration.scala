package controllers.admin

import akka.actor.actorRef2Scala
import brainflight.mail.DefaultMails
import brainflight.mail.Send
import brainflight.security.AuthenticatedRequest
import brainflight.security.Secured
import controllers.Application
import controllers.Controller
import models.security.Role
import models.user.TimeTracking
import models.user.User
import play.api.i18n.Messages
import views.html

object UserAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  def index = Authenticated { implicit request =>
    Ok(html.admin.user.userAdministration(request.user, User.findAll.sortBy(_.lastName), Role.findAll.sortBy(_.name)))
  }

  def logTime(userId: String, time: String) = Authenticated { implicit request =>
    User.findOneById(userId) map { user =>
      TimeTracking.parseTime(time) match {
        case Some(t) =>
          TimeTracking.logTime(user, t)
          Ok
        case _ =>
          BadRequest("Invalid time.")
      }
    } getOrElse BadRequest("Didn't find user")
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
        BadRequest("'id' parameter is missing.")
    }
  }

  private def verifyUser(userId: String) = {
    User.findOneById(userId) map { user =>
      if (!user.verified) {
        Application.Mailer ! Send(DefaultMails.verifiedMail(user.name, user.email))
        User.verify(user)
      } else
        user
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

  private def deleteUser(userId: String) = {
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

  private def addRole(roleName: String)(userId: String) = {
    User.findOneById(userId) map { user =>
      User.addRole(user, roleName)
    }
  }

  private def removeRole(roleName: String)(userId: String) = {
    User.findOneById(userId) map { user =>
      User.removeRole(user, roleName)
    }
  }

  def removeRoleBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    postParameter("role").map { roleName =>
      bulkOperation(removeRole(roleName))(
        user => "Removed role from %s".format(user.name),
        userId => "Couldn't remove role from user with id '%s'".format(userId))
    } getOrElse AjaxBadRequest.error("Please choose a role")
  }

  def addRoleBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    postParameter("role").map { roleName =>
      bulkOperation(addRole(roleName))(
        user => "Added role to %s".format(user.name),
        userId => "Couldn't add role to user with id '%s'".format(userId))
    } getOrElse AjaxBadRequest.error("Please choose a role")
  }
}