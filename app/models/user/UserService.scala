package models.user

import play.api.{Logger, Application}
import scala.Some
import scala.concurrent.{Future, Await}
import scala.concurrent.duration._
import oxalis.user.UserCache
import models.team.{TeamDAO, Role, TeamMembership, Team}
import reactivemongo.bson.BSONObjectID
import play.api.i18n.Messages
import oxalis.mail.DefaultMails
import braingames.util.{FoxImplicits, Fox}
import controllers.Application
import braingames.mail.Send
import net.liftweb.common.Failure
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import braingames.security.SCrypt._
import braingames.mail.Send
import play.api.libs.concurrent.Execution.Implicits._

object UserService extends FoxImplicits {
  val defaultUserEmail = "scmboy@scalableminds.com"

  lazy val defaultUser = {
    UserDAO.findOneByEmail(defaultUserEmail)(GlobalAccessContext)
  }

  def findAll()(implicit ctx: DBAccessContext) =
    UserDAO.findAll

  def findOneById(id: String, useCache: Boolean)(implicit ctx: DBAccessContext): Future[Option[User]] = {
    if (useCache)
      UserCache.findUser(id)
    else
      UserCache.store(id, UserDAO.findOneById(id))
  }

  def logActivity(user: User, lastActivity: Long)  {
    UserDAO.logActivity(user, lastActivity)(GlobalAccessContext)
  }

  def insert(teamName: String, email: String, firstName: String, lastName: String, password: String, isVerified: Boolean) = {
    for{
      teamOpt <- TeamDAO.findOneByName(teamName)(GlobalAccessContext)
      teamMemberships = teamOpt.map(t => TeamMembership(t.name, Role.User)).toList
      user = User(email, firstName, lastName, false, hashPassword(password), teamMemberships)
      _ <- UserDAO.insert(user, isVerified)(GlobalAccessContext)
    } yield user
  }

  def findOneByEmail(email: String): Future[Option[User]] = {
    UserDAO.findOneByEmail(email)(GlobalAccessContext)
  }

  def updateSettings(user: User, settings: UserSettings)(implicit ctx: DBAccessContext) = {
    UserDAO.updateSettings(user, settings)
  }

  def auth(email: String, password: String): Future[Option[User]] =
    UserDAO.auth(email, password)(GlobalAccessContext)

  def verify(_user: BSONObjectID)(implicit ctx: DBAccessContext): Fox[String] = {
    def verifyHim(user: User) = {
      val u = user.verify
      UserDAO.verify(u)
    }

    for {
      user <- UserDAO.findOneById(_user)(GlobalAccessContext) ?~> Messages("user.notFound")
      if (!user.verified)
      _ <- verifyHim(user)
    } yield {
      Application.Mailer ! Send(DefaultMails.verifiedMail(user.name, user.email))
      user.name
    }
  }

  private def userIsAllowedToAssignTeam(teamMembership: TeamMembership, user: User) =
    user.roleInTeam(teamMembership.team) == Some(Role.Admin)

  def assignToTeams(teamMemberships: Seq[TeamMembership], assigningUser: User)(_user: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Seq[TeamMembership]] = {
    teamMemberships.find(!userIsAllowedToAssignTeam(_, assigningUser)) match {
      case None =>
        for {
          _ <- UserDAO.addTeams(_user, teamMemberships) ?~> Messages("team.assign.failed")
        } yield {
          teamMemberships
        }
      case _ =>
        Failure(Messages("team.assign.notAllowed"))
    }
  }

  def addRole(_user: BSONObjectID, role: String)(implicit ctx: DBAccessContext) =
    UserDAO.addRole(_user, role)

  def deleteRole(_user: BSONObjectID, role: String)(implicit ctx: DBAccessContext) =
    UserDAO.deleteRole(_user, role)

  def increaseExperience(_user: BSONObjectID, domain: String, value: Int)(implicit ctx: DBAccessContext) = {
    UserDAO.increaseExperience(_user, domain.trim, value)
  }

  def setExperience(_user: BSONObjectID, domain: String, value: Int)(implicit ctx: DBAccessContext) = {
    UserDAO.setExperience(_user, domain.trim, value)
  }

  def deleteExperience(_user: BSONObjectID, domain: String)(implicit ctx: DBAccessContext) = {
    UserDAO.deleteExperience(_user, domain.trim)
  }
}