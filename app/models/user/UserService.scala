package models.user

import java.util.UUID

import oxalis.thirdparty.BrainTracing
import play.api.libs.json.Json
import play.api.{Logger, Application}
import scala.Some
import scala.concurrent.{Future, Await}
import scala.concurrent.duration._
import oxalis.user.UserCache
import models.team.{TeamDAO, Role, TeamMembership, Team}
import reactivemongo.bson.BSONObjectID
import play.api.i18n.Messages
import oxalis.mail.DefaultMails
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import controllers.Application
import com.scalableminds.util.mail.Send
import net.liftweb.common.Failure
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import com.scalableminds.util.security.SCrypt._
import com.scalableminds.util.mail.Send
import play.api.libs.concurrent.Execution.Implicits._
import models.annotation.{AnnotationType, AnnotationDAO, AnnotationService}

object UserService extends FoxImplicits {
  val defaultUserEmail = "scmboy@scalableminds.com"

  lazy val defaultUser = {
    UserDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)
  }

  def removeTeamFromUsers(team: Team)(implicit ctx: DBAccessContext) = {
    UserDAO.removeTeamFromUsers(team.name)
  }

  def findAll()(implicit ctx: DBAccessContext) =
    UserDAO.findAll

  def findAllNonAnonymous()(implicit ctx: DBAccessContext) =
    UserDAO.findAllNonAnonymous

  def findByTeams(teams: List[String])(implicit ctx: DBAccessContext) = {
    UserDAO.findByTeams(teams)
  }

  def countNonAnonymousUsers()(implicit ctx: DBAccessContext) = {
    UserDAO.countNonAnonymousUsers
  }

  def findOneById(id: String, useCache: Boolean)(implicit ctx: DBAccessContext): Fox[User] = {
    if (useCache)
      UserCache.findUser(id)
    else
      UserCache.store(id, UserDAO.findOneById(id))
  }

  def logActivity(_user: BSONObjectID, lastActivity: Long) = {
    UserDAO.logActivity(_user, lastActivity)(GlobalAccessContext)
  }

  def insert(teamName: String, email: String, firstName: String, lastName: String, password: String, isVerified: Boolean): Fox[User] =
    for {
      teamOpt <- TeamDAO.findOneByName(teamName)(GlobalAccessContext).futureBox
      teamMemberships = teamOpt.map(t => TeamMembership(t.name, Role.User)).toList
      user = User(email, firstName, lastName, false, hashPassword(password), md5(password), teamMemberships)
      result <- UserDAO.insert(user, isVerified)(GlobalAccessContext).futureBox
    } yield result

  def insertAnonymousUser(teamName: String, experience: Experience): Fox[User] = {
    val userName = UUID.randomUUID().toString
    for {
      teamOpt <- TeamDAO.findOneByName(teamName)(GlobalAccessContext).futureBox
      teamMemberships = teamOpt.map(t => TeamMembership(t.name, Role.User)).toList
      user = User(
        userName,
        "Anonymous", "User",
        verified = true,
        pwdHash = "",
        md5hash = "",
        teams = teamMemberships,
        _isAnonymous = Some(true),
        experiences = experience.toMap)
      result <- UserDAO.insert(user, isVerified = true)(GlobalAccessContext).futureBox
    } yield {
      result
    }
  }

  def update(user: User, firstName: String, lastName: String, verified: Boolean, teams: List[TeamMembership], experiences: Map[String, Int])(implicit ctx: DBAccessContext) = {
    if (!user.verified && verified) {
      Application.Mailer ! Send(DefaultMails.verifiedMail(user.name, user.email))
      if(user.teams.isEmpty){
        BrainTracing.register(user)
      }
    }
    UserDAO.update(user._id, firstName, lastName, verified, teams, experiences).map {
      result =>
        UserCache.invalidateUser(user.id)
        result
    }
  }

  def changePassword(user: User, newPassword: String)(implicit ctx: DBAccessContext) = {
    if (user.verified)
      Application.Mailer ! Send(DefaultMails.changePasswordMail(user.name, user.email))

    UserDAO.changePassword(user._id, newPassword).map { result =>
      UserCache.invalidateUser(user.id)
      result
    }

  }

  def removeFromAllPossibleTeams(user: User, issuingUser: User)(implicit ctx: DBAccessContext) = {
    if (user.teamNames.diff(issuingUser.adminTeamNames).isEmpty) {
      // if a user doesn't belong to any team any more he gets deleted
      UserDAO.removeById(user._id).flatMap {
        _ =>
          UserCache.invalidateUser(user.id)
          AnnotationService.freeAnnotationsOfUser(user)
      }
    } else {
      // the issuing user is not able to remove the user from all teams, therefore the account is not getting deleted
      UserDAO.updateTeams(user._id, user.teams.filterNot(t => issuingUser.adminTeams.contains(t.team)))
    }
  }

  def findOneByEmail(email: String): Fox[User] = {
    UserDAO.findOneByEmail(email)(GlobalAccessContext)
  }

  def findFinishedTasksOf(user: User)(implicit ctx: DBAccessContext) =
    AnnotationService.findTasksOf(user).map(_.flatMap(_._task))

  def updateSettings(user: User, settings: UserSettings)(implicit ctx: DBAccessContext) = {
    UserDAO.updateSettings(user, settings).map {
      result =>
        UserCache.invalidateUser(user.id)
        result
    }
  }

  def auth(email: String, password: String): Fox[User] =
    UserDAO.auth(email, password)(GlobalAccessContext)

  def authByToken(token: String)(implicit ctx: DBAccessContext): Fox[User] = {
    Logger.warn("Trying to auth with token: " + token)
    LoginTokenDAO.findBy(token).flatMap { loginToken =>
      UserDAO.findOneById(loginToken._user)
    }
  }

  def createLoginToken(user: User, validDuration: Duration)(implicit ctx: DBAccessContext): Fox[String] = {
    val token = UUID.randomUUID().toString
    val expirationTime = System.currentTimeMillis + validDuration.toMillis
    LoginTokenDAO.insert(LoginToken(user._id, token, expirationTime)).map( _ => token)
  }

  def increaseExperience(_user: BSONObjectID, domain: String, value: Int)(implicit ctx: DBAccessContext) = {
    UserDAO.increaseExperience(_user, domain.trim, value)
  }
}
