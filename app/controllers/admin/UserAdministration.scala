package controllers.admin

import oxalis.security.AuthenticatedRequest
import controllers._
import models.user._
import play.api.i18n.Messages
import views.html
import net.liftweb.common._
import braingames.util.ExtendedTypes.ExtendedString
import models.annotation.AnnotationService
import play.api.Logger
import models.team.{Role, TeamMembership}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc.Request
import models.user.time.{TimeTrackingService, TimeTracking}
import reactivemongo.bson.BSONObjectID
import braingames.util.Fox
import scala.concurrent.Future
import braingames.reactivemongo.DBAccessContext
import net.liftweb.common.Full
import play.api.libs.json.{Writes, Json}

object UserAdministration extends AdminController with Dashboard {

  def sortedUsers(implicit ctx: DBAccessContext) = UserDAO.findAll.map(_.sortBy(_.lastName.capitalize))

  def bulkOperation(operation: BSONObjectID => Fox[String], successMessage: String => String)(implicit request: AuthenticatedRequest[Map[String, Seq[String]]]) = {
    def executeOperation(_user: String) =
      BSONObjectID.parse(_user).toOption.toFox.flatMap(operation).futureBox.map {
        case Full(userName) => jsonSuccess -> successMessage(userName)
        case Failure(msg, _, _) => jsonError -> msg
        case Empty => jsonError -> (Messages("user.bulk.failedFor", _user))
      }

    for {
      ids <- request.body.get("id") ?~> Messages("user.bulk.empty")
      results <- Future.traverse(ids)(executeOperation)
      users <- sortedUsers
    } yield {
      JsonOk(html.admin.user.userTable(users), results)
    }
  }

  def list = Authenticated.async{ implicit request =>
    for{
      users <- UserDAO.findAllInTeams(request.user.adminTeamNames)
    } yield Ok(Writes.list(User.userPublicWrites).writes(users))
  }

  def show(userId: String) = Authenticated.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(request.user, user).toFox
      loggedTime <- TimeTrackingService.loggedTime(user)
      info <- dashboardInfo(user)
    } yield Ok(html.admin.user.user(info))
  }

  def index = Authenticated.async { implicit request =>
    for {
      users <- sortedUsers
      experiences <- ExperienceService.findAllDomains
    } yield {
      Ok(html.admin.user.userList(users, experiences.toList, request.user.adminTeams.map(_.team)))
    }
  }

  def logTime(userId: String, time: String, note: String) = Authenticated.async { implicit request =>
    for {
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(request.user, user).toFox
      time <- TimeTracking.parseTime(time) ?~> Messages("time.invalidFormat")
    } yield {
      TimeTrackingService.logTime(user, time, note)
      JsonOk
    }
  }

  def extractTeamsFromRequest(request: Request[Map[String, Seq[String]]]) = {
    request.body.get("teams").getOrElse(Nil).map {
      t => TeamMembership(t, Role.User)
    }
  }

  private def verifyAndAssign(_user: BSONObjectID, teams: Seq[TeamMembership], issuingUser: User)(implicit ctx: DBAccessContext): Fox[String] = {
    for {
      user <- UserDAO.findOneById(_user) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(issuingUser, user).toFox
      userName <- UserService.verify(user._id) ?~> Messages("user.verifyFailed")
      _ <- UserService.assignToTeams(teams, issuingUser)(user._id)
    } yield {
      userName
    }
  }

  def verify(userId: String) = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      _user <- BSONObjectID.parse(userId).toOption.toFox ?~> Messages("bsonid.invalid")
      _ <- verifyAndAssign(_user, extractTeamsFromRequest(request), request.user)
      updated <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
    } yield {
      JsonOk(html.admin.user.userTableItem(updated), Messages("user.verified", updated.name))
    }
  }

  def verifyBulk = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    implicit val issuingUser = request.user
    val teams = extractTeamsFromRequest(request)
    bulkOperation(verifyAndAssign(_, teams, issuingUser), Messages("user.verified", _))
  }

  private def deleteUser(_user: BSONObjectID, issuingUser: User)(implicit ctx: DBAccessContext) = {
    for {
      user <- UserDAO.findOneById(_user) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(issuingUser, user).toFox
      _ <- UserDAO.removeById(user._id)
      _ <- Future.successful(AnnotationService.freeAnnotationsOfUser(user))
    } yield {
      user.name
    }
  }

  def delete(userId: String) = Authenticated.async { implicit request =>
    for {
      _user <- BSONObjectID.parse(userId).toOption.toFox ?~> Messages("bsonid.invalid")
      name <- deleteUser(_user, request.user)
    } yield {
      JsonOk(Messages("user.deleted", name))
    }
  }

  def deleteBulk = Authenticated.async(parse.urlFormEncoded) {
    implicit request =>
      bulkOperation(deleteUser(_, request.user), Messages("user.deleted", _))
  }

  // TODO: secure
  private def addRole(_user: BSONObjectID, roleName: String)(implicit ctx: DBAccessContext) = {
    for {
      user <- UserDAO.findOneById(_user) ?~> Messages("user.notFound")
      _ <- UserService.addRole(_user, roleName)
    } yield {
      Logger.info("Added role: " + roleName)
      user.name
    }
  }

  // TODO: secure
  private def deleteRole(_user: BSONObjectID, roleName: String)(implicit ctx: DBAccessContext) = {
    for {
      user <- UserDAO.findOneById(_user) ?~> Messages("user.notFound")
      _ <- UserService.deleteRole(_user, roleName)
    } yield {
      user.name
    }
  }

//  def loginAsUser(userId: String) = Authenticated(permission = Some(Permission("admin.ghost"))).async { implicit request =>
//    for {
//      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
//    } yield {
//      Redirect(controllers.routes.UserController.dashboard)
//      .withSession(Secured.createSession(user))
//    }
//  }

  def deleteRoleBulk = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      roleName <- postParameter("role") ?~> Messages("role.invalid")
      result <- bulkOperation(deleteRole(_, roleName), Messages("role.removed", _))
    } yield {
      result
    }
  }

  def addRoleBulk = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      roleName <- postParameter("role") ?~> Messages("role.invalid")
      result <- bulkOperation(addRole(_, roleName), Messages("role.added", _))
    } yield {
      result
    }
  }

  private def increaseExp(_user: BSONObjectID, domain: String, value: Int, issuingUser: User)(implicit ctx: DBAccessContext) = {
    for {
      user <- UserDAO.findOneById(_user) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(issuingUser, user).toFox
      _ <- UserService.increaseExperience(_user, domain, value)
    } yield {
      user.name
    }
  }

  private def setExp(_user: BSONObjectID, domain: String, value: Int, issuingUser: User)(implicit ctx: DBAccessContext) = {
    for {
      user <- UserDAO.findOneById(_user) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(issuingUser, user).toFox
      _ <- UserService.setExperience(_user, domain, value)
    } yield {
      user.name
    }
  }

  private def deleteExp(_user: BSONObjectID, domain: String, issuingUser: User)(implicit ctx: DBAccessContext) = {
    for {
      user <- UserDAO.findOneById(_user) ?~> Messages("user.notFound")
      _ <- allowedToAdministrate(issuingUser, user).toFox
      _ <- UserService.deleteExperience(_user, domain)
    } yield {
      user.name
    }
  }

  def increaseExperienceBulk = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      domain <- postParameter("experience-domain") ?~> Messages("experience.domain.invalid")
      value <- postParameter("experience-value").flatMap(_.toIntOpt) ?~> Messages("experience.value.invalid")
      result <- bulkOperation(increaseExp(_, domain, value, request.user), Messages("user.experience.increased", _))
    } yield {
      result
    }
  }

  def setExperienceBulk = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      domain <- postParameter("experience-domain") ?~> Messages("experience.domain.invalid")
      value <- postParameter("experience-value").flatMap(_.toIntOpt) ?~> Messages("experience.value.invalid")
      result <- bulkOperation(setExp(_, domain, value, request.user), Messages("user.experience.set", _))
    } yield {
      result
    }
  }

  def deleteExperienceBulk = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      domain <- postParameter("experience-domain") ?~> Messages("experience.domain.invalid")
      result <- bulkOperation(deleteExp(_, domain, request.user), Messages("user.experience.removed", _))
    } yield {
      result
    }
  }

}