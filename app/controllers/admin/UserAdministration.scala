package controllers.admin

import akka.actor.actorRef2Scala
import oxalis.mail.DefaultMails
import braingames.mail.Send
import oxalis.security.AuthenticatedRequest
import oxalis.security.Secured
import controllers._
import models.security._
import models.user.TimeTracking
import models.user.User
import models.user.Experience
import models.tracing.TracingType
import play.api.i18n.Messages
import views.html
import net.liftweb.common._
import braingames.mvc.Controller
import braingames.util.ExtendedTypes.ExtendedString
import models.tracing.Tracing

object UserAdministration extends Controller with Secured {

  override val DefaultAccessRole = Role.Admin

  def allUsers = User.findAll.sortBy(_.lastName.capitalize)

  def index = Authenticated { implicit request =>
    Ok(html.admin.user.userList(allUsers, Role.findAll.sortBy(_.name), Experience.findAllDomains))
  }

  def show(userId: String) = Authenticated { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      val tracings = Tracing.findFor(user).filter(t => !TracingType.isSystemTracing(t))
      val (taskTracings, allExplorationalTracings) =
        tracings.partition(_.tracingType == TracingType.Task)

      val explorationalTracings =
        allExplorationalTracings
          .filter(!_.state.isFinished)
          .sortBy(-_.timestamp)

      val userTasks = taskTracings.flatMap(e => e.task.map(_ -> e))

      val loggedTime = TimeTracking.loggedTime(user)

      Ok(html.admin.user.user(
        user,
        explorationalTracings,
        userTasks,
        loggedTime))
    }
  }

  def logTime(userId: String, time: String, note: String) = Authenticated { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
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
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
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
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      User.removeById(user._id)
      Tracing.freeTacingsOfUser(user._id)
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
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      user.update(_.addRole(roleName))
    }
  }

  private def deleteRole(roleName: String)(userId: String) = {
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      user.update(_.deleteRole(roleName))
    }
  }

  def loginAsUser(userId: String) = Authenticated(permission = Some(Permission("admin.ghost"))) { implicit request =>
    for {
      user <- User.findOneById(userId) ?~ Messages("user.notFound")
    } yield {
      Redirect(controllers.routes.UserController.dashboard)
        .withSession(Secured.createSession(user))
    }
  }

  def deleteRoleBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      roleName <- postParameter("role") ?~ Messages("role.invalid")
    } yield {
      bulkOperation(deleteRole(roleName))(
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

  def increaseExperience(domain: String, value: Int)(userId: String) = {
    User.findOneById(userId) map { user =>
      user.update(_.increaseExperience(domain, value))
    }
  }

  def setExperience(domain: String, value: Int)(userId: String) = {
    User.findOneById(userId) map { user =>
      user.update(_.setExperience(domain, value))
    }
  }

  def deleteExperience(domain: String)(userId: String) = {
    User.findOneById(userId) map { user =>
      user.update(_.deleteExperience(domain))
    }
  }

  def increaseExperienceBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      domain <- postParameter("experience-domain") ?~ Messages("experience.domain.invalid")
      value <- postParameter("experience-value").flatMap(_.toIntOpt) ?~ Messages("experience.value.invalid")
    } yield {
      bulkOperation(increaseExperience(domain, value))(
        user => Messages("user.experience.increased", user.name))
    }
  }

  def setExperienceBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      domain <- postParameter("experience-domain") ?~ Messages("experience.domain.invalid")
      value <- postParameter("experience-value").flatMap(_.toIntOpt) ?~ Messages("experience.value.invalid")
    } yield {
      bulkOperation(setExperience(domain, value))(
        user => Messages("user.experience.set", user.name))
    }
  }

  def deleteExperienceBulk = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      domain <- postParameter("experience-domain") ?~ Messages("experience.domain.invalid")
    } yield {
      bulkOperation(deleteExperience(domain))(
        user => Messages("user.experience.removed", user.name))
    }
  }

}