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
import models.binary.DataSetDAO
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
import utils.{ObjectId, WkConf}

import scala.concurrent.Future

object UserService extends FoxImplicits {

  lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val defaultUserEmail = WkConf.Application.Authentication.DefaultUser.email

  val tokenDAO = WebknossosSilhouette.environment.tokenDAO

  def defaultUser = {
    UserDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)
  }

  def findByTeams(teams: List[ObjectId])(implicit ctx: DBAccessContext) = {
    UserDAO.findAllByTeams(teams)
  }

  def findOneById(userId: ObjectId, useCache: Boolean)(implicit ctx: DBAccessContext): Fox[User] = {
    if (useCache)
      UserCache.findUser(userId)
    else
      UserCache.store(userId, UserDAO.findOne(userId))
  }

  def logActivity(_user: ObjectId, lastActivity: Long) = {
    UserDAO.updateLastActivity(_user, lastActivity)(GlobalAccessContext)
  }

  def insert(_organization: ObjectId, email: String, firstName: String,
             lastName: String, isActive: Boolean, teamRole: Boolean = false, loginInfo: LoginInfo, passwordInfo: PasswordInfo, isAdmin: Boolean = false): Fox[User] = {
    implicit val ctx = GlobalAccessContext
    for {
      organizationTeamId <- OrganizationDAO.findOne(_organization).flatMap(_.organizationTeamId).toFox
      orgTeam <- TeamDAO.findOne(organizationTeamId)
      teamMemberships = List(TeamMembership(orgTeam._id, teamRole))
      user = User(
        ObjectId.generate,
        _organization,
        email,
        firstName,
        lastName,
        System.currentTimeMillis(),
        Json.toJson(UserConfiguration.default),
        loginInfo,
        passwordInfo,
        isAdmin,
        isSuperUser = false,
        isDeactivated = !isActive
      )
      _ <- UserDAO.insertOne(user)
      _ <- Fox.combined(teamMemberships.map(UserTeamRolesDAO.insertTeamMembership(user._id, _)))
    } yield user
  }

  def update(
              user: User,
              firstName: String,
              lastName: String,
              email: String,
              activated: Boolean,
              isAdmin: Boolean,
              teamMemberships: List[TeamMembership],
              experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[User] = {

    if (user.isDeactivated && activated) {
      Mailer ! Send(DefaultMails.activatedMail(user.name, user.email))
    }
    for {
      _ <- UserDAO.updateValues(user._id, firstName, lastName, email, isAdmin, isDeactivated = !activated)
      _ <- UserTeamRolesDAO.updateTeamMembershipsForUser(user._id, teamMemberships)
      _ <- UserExperiencesDAO.updateExperiencesForUser(user._id, experiences)
      _ = UserCache.invalidateUser(user._id)
      _ <- if (user.email == email) Fox.successful(()) else WebknossosSilhouette.environment.tokenDAO.updateEmail(user.email, email)
      updated <- UserDAO.findOne(user._id)
    } yield updated
  }

  def changePasswordInfo(loginInfo: LoginInfo, passwordInfo: PasswordInfo) = {
    for {
      user <- findOneByEmail(loginInfo.providerKey)
      _ <- UserDAO.updatePasswordInfo(user._id, passwordInfo)(GlobalAccessContext)
    } yield {
      passwordInfo
    }
  }

  def findOneByEmail(email: String): Fox[User] = {
    UserDAO.findOneByEmail(email)(GlobalAccessContext)
  }

  def updateUserConfiguration(user: User, configuration: UserConfiguration)(implicit ctx: DBAccessContext) = {
    UserDAO.updateUserConfiguration(user._id, configuration).map {
      result =>
        UserCache.invalidateUser(user._id)
        result
    }
  }

  def updateDataSetConfiguration(user: User, dataSetName: String, configuration: DataSetConfiguration)(implicit ctx: DBAccessContext) =
    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName)
      _ <- UserDataSetConfigurationDAO.updateDatasetConfigurationForUserAndDataset(user._id, dataSet._id, configuration.configuration)
      _ = UserCache.invalidateUser(user._id)
    } yield ()

  def retrieve(loginInfo: LoginInfo): Future[Option[User]] =
    UserDAO.findOneByEmail(loginInfo.providerKey)(GlobalAccessContext).futureBox.map(_.toOption)

  def createLoginInfo(email: String): LoginInfo = {
    LoginInfo(CredentialsProvider.ID, email)
  }

  def createPasswordInfo(pw: String): PasswordInfo = {
    PasswordInfo("SCrypt", SCrypt.hashPassword(pw))
  }
}

object UserIdentityService extends IdentityService[User] {

  def retrieve(loginInfo: LoginInfo): Future[Option[User]] =
    UserDAO.findOneByEmail(loginInfo.providerKey)(GlobalAccessContext).futureBox.map(_.toOption)

}
