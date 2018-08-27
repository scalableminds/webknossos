package controllers

import com.mohiva.play.silhouette.api.LoginInfo
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.binary._
import models.configuration.UserConfiguration
import models.project.{Project, ProjectDAO}
import models.task.{TaskType, TaskTypeDAO}
import models.team._
import models.user._
import net.liftweb.common.Full
import org.joda.time.DateTime
import oxalis.security.{Token, TokenDAO, TokenType}
import play.api.i18n.MessagesApi
import play.api.Play.current
import oxalis.security.WebknossosSilhouette.UserAwareAction
import play.api.Play
import play.api.libs.json.Json
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext.Implicits.global

class InitialDataController @Inject() (val messagesApi: MessagesApi)
  extends Controller with FoxImplicits {

  def triggerInsert = UserAwareAction.async { implicit request =>
    for {
      _ <- InitialDataService.insert
    } yield Ok
  }
}


object InitialDataService extends FoxImplicits with LazyLogging {
  implicit val ctx = GlobalAccessContext

  val defaultUserEmail = WkConf.Application.Authentication.DefaultUser.email
  val defaultUserPassword = WkConf.Application.Authentication.DefaultUser.password
  val additionalInformation = """**Sample Organization**

Sample Street 123
Sampletown
Samplecountry
"""
  val organizationTeamId = ObjectId.generate
  val defaultOrganization = Organization(ObjectId.generate, "Connectomics department", additionalInformation, "/assets/images/mpi-logos.svg", "MPI for Brain Research")
  val organizationTeam = Team(organizationTeamId, defaultOrganization._id, defaultOrganization.name, true)
  val defaultUser = User(
    ObjectId.generate,
    defaultOrganization._id,
    defaultUserEmail,
    "SCM",
    "Boy",
    System.currentTimeMillis(),
    Json.toJson(UserConfiguration.default),
    UserService.createLoginInfo(defaultUserEmail),
    UserService.createPasswordInfo(defaultUserPassword),
    isAdmin = true,
    isSuperUser = WkConf.Application.Authentication.DefaultUser.isSuperUser,
    isDeactivated = false
  )

  def insert: Fox[Unit] =
    for {
      _ <- assertInitialDataEnabled
      _ <- assertNoOrganizationsPresent
      _ <- insertOrganization
      _ <- insertTeams
      _ <- insertDefaultUser
      _ <- insertToken
      _ <- insertTaskType
      _ <- insertProject
      _ <- insertLocalDataStoreIfEnabled
    } yield ()

  def assertInitialDataEnabled =
    for {
      _ <- bool2Fox(WkConf.Application.insertInitialData) ?~> "initialData.notEnabled"
    } yield ()

  def assertNoOrganizationsPresent =
    for {
      organizations <- OrganizationDAO.findAll
      _ <- bool2Fox(organizations.isEmpty) ?~> "initialData.organizationsNotEmpty"
    } yield ()

  def insertDefaultUser =  {
    UserService.defaultUser.futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        for {
          _ <- UserDAO.insertOne(defaultUser)
          _ <- UserExperiencesDAO.updateExperiencesForUser(defaultUser._id, Map("sampleExp" -> 10))
          _ <- UserTeamRolesDAO.insertTeamMembership(defaultUser._id, TeamMembershipSQL(organizationTeam._id, true))
          _ = logger.info("Inserted default user scmboy")
        } yield ()
    }.toFox
  }

  def insertToken = {
    val expiryTime = Play.configuration.underlying.getDuration("silhouette.tokenAuthenticator.authenticatorExpiry").toMillis
    TokenDAO.findOneByLoginInfo("credentials", defaultUserEmail, TokenType.Authentication).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        val newToken = Token(
          ObjectId.generate,
          "secretScmBoyToken",
          LoginInfo("credentials", defaultUserEmail),
          new DateTime(System.currentTimeMillis()),
          new DateTime(System.currentTimeMillis() + expiryTime),
          None,
          TokenType.Authentication
        )
      TokenDAO.insertOne(newToken)
    }
  }

  def insertOrganization = {
    OrganizationDAO.findOneByName(defaultOrganization.name).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        OrganizationDAO.insertOne(defaultOrganization)
    }.toFox
  }

  def insertTeams = {
    TeamDAO.findAll.flatMap {
      teams =>
        if (teams.isEmpty)
          TeamDAO.insertOne(organizationTeam)
        else
          Fox.successful(())
    }.toFox
  }

  def insertTaskType = {
    TaskTypeDAO.findAll.flatMap {
      types =>
        if (types.isEmpty) {
          val taskType = TaskType(
            ObjectId.generate,
            organizationTeam._id,
            "sampleTaskType",
            "Check those cells out!"
            )
          for {_ <- TaskTypeDAO.insertOne(taskType)} yield ()
        }
        else Fox.successful(())
    }.toFox
  }

  def insertProject = {
    ProjectDAO.findAll.flatMap {
      projects =>
        if (projects.isEmpty) {
          UserService.defaultUser.flatMap { user =>
            val project = Project(ObjectId.generate, organizationTeam._id, user._id, "sampleProject", 100, false, Some(5400000))
            for {_ <- ProjectDAO.insertOne(project)} yield ()
          }
        } else Fox.successful(())
    }.toFox
  }

  def insertLocalDataStoreIfEnabled: Fox[Any] = {
    if (WkConf.Datastore.enabled) {
      DataStoreDAO.findOneByName("localhost").futureBox.map { maybeStore =>
        if (maybeStore.isEmpty) {
          DataStoreDAO.insertOne(DataStore("localhost", WkConf.Http.uri, WkConf.Datastore.key))
        }
      }
    } else Fox.successful(())
  }
}
