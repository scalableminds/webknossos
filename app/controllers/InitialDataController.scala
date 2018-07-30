package controllers

import com.mohiva.play.silhouette.api.LoginInfo
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.binary._
import models.configuration.UserConfiguration
import models.project.{ProjectSQL, ProjectSQLDAO}
import models.task.{TaskTypeSQL, TaskTypeSQLDAO}
import models.team._
import models.user._
import net.liftweb.common.Full
import org.joda.time.DateTime
import oxalis.security.{TokenSQL, TokenSQLDAO, TokenType}
import play.api.i18n.MessagesApi
import play.api.Play.current
import oxalis.security.WebknossosSilhouette.UserAwareAction
import play.api.Play
import play.api.libs.json.Json
import utils.ObjectId

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

  val defaultUserEmail = Play.configuration.getString("application.authentication.defaultUser.email").getOrElse("scmboy@scalableminds.com")
  val defaultUserPassword = Play.configuration.getString("application.authentication.defaultUser.password").getOrElse("secret")
  val additionalInformation = """**Sample Organization**

Sample Street 123
Sampletown
Samplecountry
"""
  val organizationTeamId = ObjectId.generate
  val defaultOrganization = OrganizationSQL(ObjectId.generate, "Connectomics department", additionalInformation, "/assets/images/mpi-logos.svg", "MPI for Brain Research")
  val organizationTeam = TeamSQL(organizationTeamId, defaultOrganization._id, defaultOrganization.name, true)
  val defaultUser = UserSQL(
    ObjectId.generate,
    defaultOrganization._id,
    defaultUserEmail,
    "SCM",
    "Boy",
    System.currentTimeMillis(),
    Json.toJson(UserConfiguration.default),
    SCrypt.md5(defaultUserPassword),
    UserService.createLoginInfo(defaultUserEmail),
    UserService.createPasswordInfo(defaultUserPassword),
    isAdmin = true,
    isSuperUser = Play.configuration.getBoolean("application.authentication.defaultUser.isSuperUser").getOrElse(false),
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
      _ <- Play.configuration.getBoolean("application.insertInitialData").getOrElse(false) ?~> "initialData.notEnabled"
    } yield ()

  def assertNoOrganizationsPresent =
    for {
      organizations <- OrganizationSQLDAO.findAll
      _ <- organizations.isEmpty ?~> "initialData.organizationsNotEmpty"
    } yield ()

  def insertDefaultUser =  {
    UserService.defaultUser.futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        for {
          _ <- UserSQLDAO.insertOne(defaultUser)
          _ <- UserExperiencesSQLDAO.updateExperiencesForUser(defaultUser._id, Map("sampleExp" -> 10))
          _ <- UserTeamRolesSQLDAO.insertTeamMembership(defaultUser._id, TeamMembershipSQL(organizationTeam._id, true))
          _ = logger.info("Inserted default user scmboy")
        } yield ()
    }.toFox
  }

  def insertToken = {
    val expiryTime = Play.configuration.underlying.getDuration("silhouette.tokenAuthenticator.authenticatorExpiry").toMillis
    TokenSQLDAO.findOneByLoginInfo("credentials", defaultUserEmail, TokenType.Authentication).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        val newToken = TokenSQL(
          ObjectId.generate,
          "secretScmBoyToken",
          LoginInfo("credentials", defaultUserEmail),
          new DateTime(System.currentTimeMillis()),
          new DateTime(System.currentTimeMillis() + expiryTime),
          None,
          TokenType.Authentication
        )
      TokenSQLDAO.insertOne(newToken)
    }
  }

  def insertOrganization = {
    OrganizationSQLDAO.findOneByName(defaultOrganization.name).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        OrganizationSQLDAO.insertOne(defaultOrganization)
    }.toFox
  }

  def insertTeams = {
    TeamSQLDAO.findAll.flatMap {
      teams =>
        if (teams.isEmpty)
          TeamSQLDAO.insertOne(organizationTeam)
        else
          Fox.successful(())
    }.toFox
  }

  def insertTaskType = {
    TaskTypeSQLDAO.findAll.flatMap {
      types =>
        if (types.isEmpty) {
          val taskType = TaskTypeSQL(
            ObjectId.generate,
            organizationTeam._id,
            "sampleTaskType",
            "Check those cells out!"
            )
          for {_ <- TaskTypeSQLDAO.insertOne(taskType)} yield ()
        }
        else Fox.successful(())
    }.toFox
  }

  def insertProject = {
    ProjectSQLDAO.findAll.flatMap {
      projects =>
        if (projects.isEmpty) {
          UserService.defaultUser.flatMap { user =>
            val project = ProjectSQL(ObjectId.generate, organizationTeam._id, user._id, "sampleProject", 100, false, Some(5400000))
            for {_ <- ProjectSQLDAO.insertOne(project)} yield ()
          }
        } else Fox.successful(())
    }.toFox
  }

  def insertLocalDataStoreIfEnabled: Fox[Any] = {
    if (Play.configuration.getBoolean("datastore.enabled").getOrElse(true)) {
      DataStoreSQLDAO.findOneByName("localhost").futureBox.map { maybeStore =>
        if (maybeStore.isEmpty) {
          val url = Play.configuration.getString("http.uri").getOrElse("http://localhost:9000")
          val key = Play.configuration.getString("datastore.key").getOrElse("something-secure")
          DataStoreSQLDAO.insertOne(DataStoreSQL("localhost", url, WebKnossosStore, key))
        }
      }
    } else Fox.successful(())
  }
}
