package controllers

import com.mohiva.play.silhouette.api.LoginInfo
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.binary._
import models.project.{ProjectSQL, ProjectSQLDAO}
import models.task.{TaskType, TaskTypeDAO}
import models.team._
import models.user.{User, UserDAO, UserService}
import net.liftweb.common.Full
import org.joda.time.DateTime
import oxalis.security.{TokenSQL, TokenSQLDAO, TokenType}
import play.api.i18n.MessagesApi
import play.api.Play.current
import oxalis.security.WebknossosSilhouette.UserAwareAction
import play.api.Play
import reactivemongo.bson.BSONObjectID
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
  val organizationTeamId = BSONObjectID.generate
  val defaultOrganization = Organization("MPI for Brain Research", "/assets/images/mpi-logos.svg", additionalInformation, "Connectomics department", List(), organizationTeamId)
  val organizationTeam = Team(defaultOrganization.name, defaultOrganization.name, organizationTeamId)
  val organizationTeamSQL = TeamSQL(ObjectId.fromBsonId(organizationTeamId), ObjectId.fromBsonId(defaultOrganization._id), defaultOrganization.name, isOrganizationTeam = true)

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
      organizations <- OrganizationDAO.findAll
      _ <- organizations.isEmpty ?~> "initialData.organizationsNotEmpty"
    } yield ()

  def insertDefaultUser =  {
    UserService.defaultUser.futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        val email = defaultUserEmail
        val password = defaultUserPassword
        logger.info("Inserted default user scmboy")
        UserDAO.insert(User(
          email,
          "SCM",
          "Boy",
          true,
          SCrypt.md5(password),
          defaultOrganization.name,
          List(TeamMembership(organizationTeam._id, organizationTeam.name, true)),
          isAdmin = true,
          loginInfo = UserService.createLoginInfo(email),
          passwordInfo = UserService.createPasswordInfo(password),
          experiences = Map("sampleExp" -> 10),
          _isSuperUser = Play.configuration.getBoolean("application.authentication.defaultUser.isSuperUser"))
        )
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
    OrganizationDAO.findOneByName(defaultOrganization.name).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        OrganizationDAO.insert(defaultOrganization)
    }.toFox
  }

  def insertTeams = {
    TeamDAO.findAll.flatMap {
      teams =>
        if (teams.isEmpty)
          TeamSQLDAO.insertOne(organizationTeamSQL)
        else
          Fox.successful(())
    }.toFox
  }

  def insertTaskType = {
    TaskTypeDAO.findAll.flatMap {
      types =>
        if (types.isEmpty) {
          val taskType = TaskType(
            "sampleTaskType",
            "Check those cells out!",
            organizationTeam._id)
          for {_ <- TaskTypeDAO.insert(taskType)} yield ()
        }
        else Fox.successful(())
    }.toFox
  }

  def insertProject = {
    ProjectSQLDAO.findAll.flatMap {
      projects =>
        if (projects.isEmpty) {
          UserService.defaultUser.flatMap { user =>
            val project = ProjectSQL(ObjectId.generate, ObjectId.fromBsonId(organizationTeam._id), ObjectId.fromBsonId(user._id), "sampleProject", 100, false, Some(5400000))
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
