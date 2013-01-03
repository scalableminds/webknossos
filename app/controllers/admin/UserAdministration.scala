package controllers.admin

import akka.actor.actorRef2Scala
import brainflight.mail.DefaultMails
import brainflight.mail.Send
import brainflight.security.AuthenticatedRequest
import brainflight.security.Secured
import controllers._
import models.security._
import models.user.TimeTracking
import models.user.User
import play.api.i18n.Messages
import views.html
import net.liftweb.common._

object UserAdministration extends Controller with Secured {
  //finished localization
  override val DefaultAccessRole = Role.Admin

  def allUsers = User.findAll.sortBy(_.lastName)

  def index = Authenticated { implicit request =>
    Ok(html.admin.user.userAdministration(allUsers, Role.findAll.sortBy(_.name)))
  }

  def logTime(userId: String, time: String, note: String) = Authenticated { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.unknown")
      time <- TimeTracking.parseTime(time) ?~ Messages("time.invalidFormat")
    } yield {
      TimeTracking.logTime(user, time, note)
      JsonOk
    }
  }

  def bulkOperation(operation: String => Box[User])(successMessage: User => String)(implicit request: AuthenticatedRequest[Map[String, Seq[String]]]) = {
    (for {
      ids <- request.body.get("id") ?~ Messages("user.bulk.empty")
    } yield {
      val results = ids.map { userId =>
        operation(userId) match {
          case Full(user)         => jsonSuccess -> successMessage(user)
          case Failure(msg, _, _) => jsonError -> msg
          case Empty              => jsonError -> (Messages("user.bulk.failedFor", userId))
        }
      }
      JsonOk(html.admin.user.userTable(allUsers), results)
    }).asResult
  }

  private def verifyUser(userId: String) = {
    for {
      user <- User.findOneById(userId) ?~ Messages("user.unknown")
      if (!user.verified)
    } yield {
      Application.Mailer ! Send(DefaultMails.verifiedMail(user.name, user.email))
      user.update(_.verify)
    }
  }

  def verify(userId: String) = Authenticated { implicit request =>
    for {
      user <- verifyUser(userId) ?~ Messages("user.verifyFailed")
    } yield {
      JsonOk(html.admin.user.userTableItem(user), Messages("user.verified", user.name))
    }
  }

  def verifyBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    bulkOperation(verifyUser)(user => Messages("user.verified", user.name))
  }

  private def deleteUser(userId: String) = {
    for {
      user <- User.findOneById(userId) ?~ Messages("user.unknown")
    } yield {
      User.remove(user)
      user
    }
  }

  def delete(userId: String) = Authenticated { implicit request =>
    deleteUser(userId).map { user =>
      JsonOk(Messages("user.deleted", user.name))
    }
  }

  def deleteBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    bulkOperation(deleteUser)(user => Messages("user.deleted", user.name))
  }

  private def addRole(roleName: String)(userId: String) = {
    for {
      user <- User.findOneById(userId) ?~ Messages("user.unknown")
    } yield {
      user.update(_.addRole(roleName))
    }
  }

  private def removeRole(roleName: String)(userId: String) = {
    for {
      user <- User.findOneById(userId) ?~ Messages("user.unknown")
    } yield {
      user.update(_.removeRole(roleName))
    }
  }

  def loginAsUser(userId: String) = Authenticated(permission = Some(Permission("admin.ghost"))) { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.unknown")
    } yield {
      Redirect(controllers.routes.UserController.dashboard)
        .withSession(Secured.createSession(user))
    }
  }

  def removeRoleBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      roleName <- postParameter("role") ?~ Messages("role.invalid")
    } yield {
      bulkOperation(removeRole(roleName))(
        user => Messages("role.removed", user.name))
    }
  }

  def addRoleBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      roleName <- postParameter("role") ?~ Messages("role.invalid")
    } yield {
      bulkOperation(addRole(roleName))(
        user => Messages("role.added", user.name))
    }
  }
}