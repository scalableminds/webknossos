package models.user

import java.util.UUID

import com.scalableminds.util.mail.Send
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.security.SCrypt._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationService
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team._
import oxalis.mail.DefaultMails
import oxalis.user.UserCache
import play.api.{Logger, Play}
import play.api.Play.current
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.duration._

object UserService extends FoxImplicits {
  lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val defaultUserEmail = Play.configuration.getString("application.authentication.defaultUser").get

  def defaultUser = {
    UserDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)
  }

  def removeTeamFromUsers(team: Team)(implicit ctx: DBAccessContext) = {
    UserDAO.removeTeamFromUsers(team.name)
  }

  def findAll()(implicit ctx: DBAccessContext) =
    UserDAO.findAll

  def findAllNonAnonymous()(implicit ctx: DBAccessContext) =
    UserDAO.findAllNonAnonymous

  def findByTeams(teams: List[String], includeAnonymous: Boolean)(implicit ctx: DBAccessContext) = {
    UserDAO.findByTeams(teams, includeAnonymous)
  }

  def countNonAnonymousUsers(implicit ctx: DBAccessContext) = {
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

  def insert(teamName: String, email: String, firstName: String,
    lastName: String, password: String, isActive: Boolean, teamRole: Role = Role.User): Fox[User] =
    for {
      teamOpt <- TeamDAO.findOneByName(teamName)(GlobalAccessContext).futureBox
      teamMemberships = teamOpt.map(t => TeamMembership(t.name, teamRole)).toList
      user = User(email, firstName, lastName, isActive = isActive, hashPassword(password), md5(password), teamMemberships)
      _ <- UserDAO.insert(user)(GlobalAccessContext)
    } yield user

  def prepareMTurkUser(workerId: String, teamName: String, experience: Experience)(implicit ctx: DBAccessContext): Fox[User] = {
    def necessaryTeamMemberships = {
      TeamDAO.findOneByName(teamName).futureBox.map { teamOpt =>
        teamOpt.map(t => TeamMembership(t.name, Role.User)).toList
      }
    }

    def insertUser(email: String): Fox[User] = {
      for {
        teamMemberships <- necessaryTeamMemberships
        user = User(
          email,
          "mturk", workerId,
          isActive = true,
          pwdHash = "",
          md5hash = "",
          teams = teamMemberships,
          _isAnonymous = Some(true),
          experiences = experience.toMap)
        _ <- UserDAO.insert(user)
      } yield user
    }

    def updateUser(u: User): Fox[User] = {
      for{
        teamMemberships <- necessaryTeamMemberships
        updated <- UserDAO.findAndModify(Json.obj("_id" -> u._id), Json.obj("$set" -> Json.obj(
          "teams" -> teamMemberships,
          "experiences" -> experience.toMap
        )), returnNew = true)
      } yield updated
    }

    val email = workerId + "@MTURK"

    UserService.findOneByEmail(email).flatMap(u => updateUser(u)) orElse insertUser(email)
  }

  def update(
    user: User,
    firstName: String,
    lastName: String,
    activated: Boolean,
    teams: List[TeamMembership],
    experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[User] = {

    if (!user.isActive && activated) {
      Mailer ! Send(DefaultMails.activatedMail(user.name, user.email))
    }
    UserDAO.update(user._id, firstName, lastName, activated, teams, experiences).map {
      result =>
        UserCache.invalidateUser(user.id)
        result
    }
  }

  def changePassword(user: User, newPassword: String)(implicit ctx: DBAccessContext) = {
    if (user.isActive)
      Mailer ! Send(DefaultMails.changePasswordMail(user.name, user.email))

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

  def updateUserConfiguration(user: User, configuration: UserConfiguration)(implicit ctx: DBAccessContext) = {
    UserDAO.updateUserConfiguration(user, configuration).map {
      result =>
        UserCache.invalidateUser(user.id)
        result
    }
  }

  def updateDataSetConfiguration(user: User, dataSetName: String, configuration: DataSetConfiguration)(implicit ctx: DBAccessContext) = {
    UserDAO.updateDataSetConfiguration(user, dataSetName, configuration).map {
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
}
