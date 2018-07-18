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
import oxalis.security.WebknossosSilhouette
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

  def findOneById(id: String, useCache: Boolean)(implicit ctx: DBAccessContext): Fox[User] = {
    if (useCache)
      UserCache.findUser(id)
    else
      UserCache.store(id, UserDAO.findOneById(id))
  }

  def logActivity(_user: ObjectId, lastActivity: Long) = {
    UserSQLDAO.updateLastActivity(_user, lastActivity)(GlobalAccessContext)
  }

  def insert(_organization: ObjectId, email: String, firstName: String,
             lastName: String, password: String, isActive: Boolean, teamRole: Boolean = false, loginInfo: LoginInfo, passwordInfo: PasswordInfo, isAdmin: Boolean = false): Fox[User] = {
    implicit val ctx = GlobalAccessContext
    for {
      organizationTeamId <- OrganizationSQLDAO.findOne(_organization).flatMap(_.organizationTeamId).toFox
      orgTeamIdBson <- organizationTeamId.toBSONObjectId.toFox
      orgTeam <- TeamDAO.findOneById(orgTeamIdBson)
      teamMemberships = List(TeamMembershipSQL(ObjectId.fromBsonId(orgTeam._id), teamRole))
      user = User(email, firstName, lastName, isActive = isActive, md5(password), organization, teamMemberships, loginInfo = loginInfo, passwordInfo = passwordInfo, isAdmin = isAdmin)
      _ <- UserDAO.insert(user)
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
              experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[User] = {

    if (user.isDeactivated && activated) {
      Mailer ! Send(DefaultMails.activatedMail(user.name, user.email))
    }
    for {
      _ <- UserSQLDAO.updateValues(user._id, firstName, lastName, email, isAdmin, !activated)
      _ <- UserTeamRolesSQLDAO.updateTeamMembershipsForUser(user._id, teamMemberships)
      _ <- UserExperiencesSQLDAO.updateExperiencesForUser(user._id, experiences)
      _ = UserCache.invalidateUser(user._id.toString)
      _ <- if (user.email == email) Fox.successful(()) else WebknossosSilhouette.environment.tokenDAO.updateEmail(user.email, email)
    } yield ()
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

  def retrieve(loginInfo: LoginInfo): Future[Option[UserSQL]] =
    UserSQLDAO.findOneByEmail(loginInfo.providerKey)(GlobalAccessContext).futureBox.map(_.toOption)

  def createLoginInfo(email: String): LoginInfo = {
    LoginInfo(CredentialsProvider.ID, email)
  }

  def createPasswordInfo(pw: String): PasswordInfo = {
    PasswordInfo("SCrypt", SCrypt.hashPassword(pw))
  }
}
