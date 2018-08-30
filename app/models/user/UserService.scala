package models.user

import akka.actor.ActorSystem
import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.services.IdentityService
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.mail.Send
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.binary.DataSetDAO
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team._
import oxalis.mail.DefaultMails
import oxalis.user.UserCache
import play.api.libs.concurrent.Execution.Implicits._
import oxalis.security.WebknossosSilhouette
import play.api.libs.json._
import utils.{ObjectId, WkConfInjected}

import scala.concurrent.Future

class UserService @Inject()(conf: WkConfInjected,
                            userDAO: UserDAO,
                            userTeamRolesDAO: UserTeamRolesDAO,
                            userExperiencesDAO: UserExperiencesDAO,
                            userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
                            organizationDAO: OrganizationDAO,
                            teamDAO: TeamDAO,
                            dataSetDAO: DataSetDAO,
                            userCache: UserCache,
                            actorSystem: ActorSystem) extends FoxImplicits with IdentityService[User] {

  lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  val defaultUserEmail = conf.Application.Authentication.DefaultUser.email

  def defaultUser = {
    userDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)
  }

  def findByTeams(teams: List[ObjectId])(implicit ctx: DBAccessContext) = {
    userDAO.findAllByTeams(teams)
  }

  def findOneById(userId: ObjectId, useCache: Boolean)(implicit ctx: DBAccessContext): Fox[User] = {
    if (useCache)
      userCache.findUser(userId)
    else
      userCache.store(userId, userDAO.findOne(userId))
  }

  def logActivity(_user: ObjectId, lastActivity: Long) = {
    userDAO.updateLastActivity(_user, lastActivity)(GlobalAccessContext)
  }

  def insert(_organization: ObjectId, email: String, firstName: String,
             lastName: String, isActive: Boolean, teamRole: Boolean = false, loginInfo: LoginInfo, passwordInfo: PasswordInfo, isAdmin: Boolean = false): Fox[User] = {
    implicit val ctx = GlobalAccessContext
    for {
      organizationTeamId <- organizationDAO.findOne(_organization).flatMap(_.organizationTeamId).toFox
      orgTeam <- teamDAO.findOne(organizationTeamId)
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
      _ <- userDAO.insertOne(user)
      _ <- Fox.combined(teamMemberships.map(userTeamRolesDAO.insertTeamMembership(user._id, _)))
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
      _ <- userDAO.updateValues(user._id, firstName, lastName, email, isAdmin, isDeactivated = !activated)
      _ <- userTeamRolesDAO.updateTeamMembershipsForUser(user._id, teamMemberships)
      _ <- userExperiencesDAO.updateExperiencesForUser(user._id, experiences)
      _ = userCache.invalidateUser(user._id)
      _ <- if (user.email == email) Fox.successful(()) else WebknossosSilhouette.environment.tokenDAO.updateEmail(user.email, email)
      updated <- userDAO.findOne(user._id)
    } yield updated
  }

  def changePasswordInfo(loginInfo: LoginInfo, passwordInfo: PasswordInfo) = {
    for {
      user <- findOneByEmail(loginInfo.providerKey)
      _ <- userDAO.updatePasswordInfo(user._id, passwordInfo)(GlobalAccessContext)
    } yield {
      passwordInfo
    }
  }

  def findOneByEmail(email: String): Fox[User] = {
    userDAO.findOneByEmail(email)(GlobalAccessContext)
  }

  def updateUserConfiguration(user: User, configuration: UserConfiguration)(implicit ctx: DBAccessContext) = {
    userDAO.updateUserConfiguration(user._id, configuration).map {
      result =>
        userCache.invalidateUser(user._id)
        result
    }
  }

  def updateDataSetConfiguration(user: User, dataSetName: String, configuration: DataSetConfiguration)(implicit ctx: DBAccessContext) =
    for {
      dataSet <- dataSetDAO.findOneByName(dataSetName)
      _ <- userDataSetConfigurationDAO.updateDatasetConfigurationForUserAndDataset(user._id, dataSet._id, configuration.configuration)
      _ = userCache.invalidateUser(user._id)
    } yield ()

  def retrieve(loginInfo: LoginInfo): Future[Option[User]] =
    findOneByEmail(loginInfo.providerKey).futureBox.map(_.toOption)

  def createLoginInfo(email: String): LoginInfo = {
    LoginInfo(CredentialsProvider.ID, email)
  }

  def createPasswordInfo(pw: String): PasswordInfo = {
    PasswordInfo("SCrypt", SCrypt.hashPassword(pw))
  }
}
