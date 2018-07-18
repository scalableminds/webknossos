package models.user

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.services.IdentityService
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.mail.Send
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.security.SCrypt._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.DataSetSQLDAO
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team._
import oxalis.mail.DefaultMails
import oxalis.user.UserCache
import play.api.Play
import play.api.Play.current
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import oxalis.security.WebknossosSilhouette
import play.api.libs.json._
import utils.ObjectId

import scala.concurrent.Future

object UserService extends FoxImplicits with IdentityService[UserSQL] {

  lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val defaultUserEmail = Play.configuration.getString("application.authentication.defaultUser.email").get

  val tokenDAO = WebknossosSilhouette.environment.tokenDAO

  def defaultUser = {
    UserSQLDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)
  }

  def removeTeamFromUsers(team: Team)(implicit ctx: DBAccessContext) = {
    UserTeamRolesSQLDAO.removeTeamFromAllUsers(ObjectId.fromBsonId(team._id))
  }

  def findByTeams(teams: List[ObjectId])(implicit ctx: DBAccessContext) = {
    UserSQLDAO.findAllByTeams(teams)
  }

  def findOneById(userId: ObjectId, useCache: Boolean)(implicit ctx: DBAccessContext): Fox[UserSQL] = {
    if (useCache)
      UserCache.findUser(userId)
    else
      UserCache.store(userId, UserSQLDAO.findOne(userId))
  }

  def logActivity(_user: ObjectId, lastActivity: Long) = {
    UserSQLDAO.updateLastActivity(_user, lastActivity)(GlobalAccessContext)
  }

  def insert(_organization: ObjectId, email: String, firstName: String,
             lastName: String, password: String, isActive: Boolean, teamRole: Boolean = false, loginInfo: LoginInfo, passwordInfo: PasswordInfo, isAdmin: Boolean = false): Fox[UserSQL] = {
    implicit val ctx = GlobalAccessContext
    for {
      organizationTeamId <- OrganizationSQLDAO.findOne(_organization).flatMap(_.organizationTeamId).toFox
      orgTeamIdBson <- organizationTeamId.toBSONObjectId.toFox
      orgTeam <- TeamDAO.findOneById(orgTeamIdBson)
      teamMemberships = List(TeamMembershipSQL(ObjectId.fromBsonId(orgTeam._id), teamRole))
      user = UserSQL(
        ObjectId.generate,
        _organization,
        email,
        firstName,
        lastName,
        System.currentTimeMillis(),
        Json.toJson(UserConfiguration.default),
        md5(password),
        loginInfo,
        passwordInfo,
        isAdmin,
        isSuperUser = false,
        !isActive
      )
      _ <- UserSQLDAO.insertOne(user)
      _ <- Fox.combined(teamMemberships.map(UserTeamRolesSQLDAO.insertTeamMembership(user._id, _)))
    } yield user
  }

  def update(
              user: UserSQL,
              firstName: String,
              lastName: String,
              email: String,
              activated: Boolean,
              isAdmin: Boolean,
              teamMemberships: List[TeamMembershipSQL],
              experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[UserSQL] = {

    if (user.isDeactivated && activated) {
      Mailer ! Send(DefaultMails.activatedMail(user.name, user.email))
    }
    for {
      _ <- UserSQLDAO.updateValues(user._id, firstName, lastName, email, isAdmin, !activated)
      _ <- UserTeamRolesSQLDAO.updateTeamMembershipsForUser(user._id, teamMemberships)
      _ <- UserExperiencesSQLDAO.updateExperiencesForUser(user._id, experiences)
      _ = UserCache.invalidateUser(user._id.toString)
      _ <- if (user.email == email) Fox.successful(()) else WebknossosSilhouette.environment.tokenDAO.updateEmail(user.email, email)
      updated <- UserSQLDAO.findOne(user._id)
    } yield updated
  }

  def changePasswordInfo(loginInfo: LoginInfo, passwordInfo: PasswordInfo) = {
    for {
      user <- findOneByEmail(loginInfo.providerKey)
      _ <- UserSQLDAO.updatePasswordInfo(user._id, passwordInfo)(GlobalAccessContext)
    } yield {
      passwordInfo
    }
  }

  def findOneByEmail(email: String): Fox[UserSQL] = {
    UserSQLDAO.findOneByEmail(email)(GlobalAccessContext)
  }

  def updateUserConfiguration(user: UserSQL, configuration: UserConfiguration)(implicit ctx: DBAccessContext) = {
    UserSQLDAO.updateUserConfiguration(user._id, configuration).map {
      result =>
        UserCache.invalidateUser(user._id.toString)
        result
    }
  }

  def updateDataSetConfiguration(user: UserSQL, dataSetName: String, configuration: DataSetConfiguration)(implicit ctx: DBAccessContext) =
    for {
      dataSet <- DataSetSQLDAO.findOneByName(dataSetName)
      _ <- UserDataSetConfigurationSQLDAO.updateDatasetConfigurationForUserAndDataset(user._id, dataSet._id, configuration.configuration)
      _ = UserCache.invalidateUser(user._id.toString)
    } yield ()

  def retrieve(loginInfo: LoginInfo): Future[Option[UserSQL]] =
    UserSQLDAO.findOneByEmail(loginInfo.providerKey)(GlobalAccessContext).futureBox.map(_.toOption)

  def createLoginInfo(email: String): LoginInfo = {
    LoginInfo(CredentialsProvider.ID, email)
  }

  def createPasswordInfo(pw: String): PasswordInfo = {
    PasswordInfo("SCrypt", SCrypt.hashPassword(pw))
  }
}
