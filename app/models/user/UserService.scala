package models.user

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.services.IdentityService
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.mail.Send
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.security.SCrypt._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationService
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team._
import oxalis.mail.DefaultMails
import oxalis.user.UserCache
import play.api.Play
import play.api.Play.current
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

object UserService extends FoxImplicits with IdentityService[User] {

  lazy val Mailer =
    Akka.system(play.api.Play.current).actorSelection("/user/mailActor")

  val defaultUserEmail = Play.configuration.getString("application.authentication.defaultUser.email").get

  def defaultUser = {
    UserDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)
  }

  def removeTeamFromUsers(team: Team)(implicit ctx: DBAccessContext) = {
    UserDAO.removeTeamFromUsers(team._id)
  }

  def findAll()(implicit ctx: DBAccessContext) =
    UserDAO.findAll

  def findByTeams(teams: List[BSONObjectID])(implicit ctx: DBAccessContext) = {
    UserDAO.findByTeams(teams)
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

  def insert(organization: String, email: String, firstName: String,
             lastName: String, password: String, isActive: Boolean, teamRole: Boolean = false, loginInfo: LoginInfo, passwordInfo: PasswordInfo): Fox[User] =
    for {
      organizationTeamId <- OrganizationDAO.findOneByName(organization)(GlobalAccessContext).map(_._organizationTeam)
      orgTeam <- TeamDAO.findOneById(organizationTeamId)(GlobalAccessContext)
      teamMemberships = List(TeamMembership(orgTeam._id, orgTeam.name, teamRole))
      user = User(email, firstName, lastName, isActive = isActive, md5(password), organization, teamMemberships, loginInfo = loginInfo, passwordInfo = passwordInfo)
      _ <- UserDAO.insert(user)(GlobalAccessContext)
    } yield user

  def update(
              user: User,
              firstName: String,
              lastName: String,
              activated: Boolean,
              isAdmin: Boolean,
              teams: List[TeamMembership],
              experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[User] = {

    if (!user.isActive && activated) {
      Mailer ! Send(DefaultMails.activatedMail(user.name, user.email))
    }
    UserDAO.update(user._id, firstName, lastName, activated, isAdmin, teams, experiences).map {
      result =>
        UserCache.invalidateUser(user.id)
        result
    }
  }

  def changePasswordInfo(loginInfo: LoginInfo, passwordInfo: PasswordInfo) = {
    for {
      user <- findOneByEmail(loginInfo.providerKey)
      _ <- UserDAO.changePasswordInfo(user._id, passwordInfo)(GlobalAccessContext)
    } yield {
      passwordInfo
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

  def retrieve(loginInfo: LoginInfo): Future[Option[User]] =
    UserDAO.findOneByEmail(loginInfo.providerKey)(GlobalAccessContext).futureBox.map(_.toOption)

  def createLoginInfo(email: String): LoginInfo = {
    LoginInfo(CredentialsProvider.ID, email)
  }

  def createPasswordInfo(pw: String): PasswordInfo = {
    PasswordInfo("SCrypt", SCrypt.hashPassword(pw))
  }
}
