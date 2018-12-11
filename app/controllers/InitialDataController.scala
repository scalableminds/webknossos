package controllers

import com.mohiva.play.silhouette.api.{LoginInfo, Silhouette}
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.{TracingStore, TracingStoreDAO}
import models.binary._
import models.configuration.UserConfiguration
import models.project.{Project, ProjectDAO}
import models.task.{TaskType, TaskTypeDAO}
import models.team._
import models.user._
import net.liftweb.common.Full
import org.joda.time.DateTime
import oxalis.security._
import play.api.i18n.MessagesApi
import play.api.libs.json.Json
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class InitialDataController @Inject()(initialDataService: InitialDataService, sil: Silhouette[WkEnv])(
    implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def triggerInsert = sil.UserAwareAction.async { implicit request =>
    for {
      _ <- initialDataService.insert
    } yield Ok
  }
}

class InitialDataService @Inject()(userService: UserService,
                                   userDAO: UserDAO,
                                   userTeamRolesDAO: UserTeamRolesDAO,
                                   userExperiencesDAO: UserExperiencesDAO,
                                   userDataSetConfigurationDAO: UserDataSetConfigurationDAO,
                                   taskTypeDAO: TaskTypeDAO,
                                   dataStoreDAO: DataStoreDAO,
                                   tracingStoreDAO: TracingStoreDAO,
                                   teamDAO: TeamDAO,
                                   tokenDAO: TokenDAO,
                                   projectDAO: ProjectDAO,
                                   organizationDAO: OrganizationDAO,
                                   conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {
  implicit val ctx = GlobalAccessContext

  val defaultUserEmail = conf.Application.Authentication.DefaultUser.email
  val defaultUserPassword = conf.Application.Authentication.DefaultUser.password
  val additionalInformation = """**Sample Organization**

Sample Street 123
Sampletown
Samplecountry
"""
  val organizationTeamId = ObjectId.generate
  val defaultOrganization = Organization(ObjectId.generate,
                                         "Connectomics_Department",
                                         additionalInformation,
                                         "/assets/images/mpi-logos.svg",
                                         "MPI for Brain Research")
  val organizationTeam = Team(organizationTeamId, defaultOrganization._id, defaultOrganization.name, true)
  val defaultUser = User(
    ObjectId.generate,
    defaultOrganization._id,
    defaultUserEmail,
    "SCM",
    "Boy",
    System.currentTimeMillis(),
    Json.toJson(UserConfiguration.default),
    userService.createLoginInfo(defaultUserEmail),
    userService.createPasswordInfo(defaultUserPassword),
    isAdmin = true,
    isSuperUser = conf.Application.Authentication.DefaultUser.isSuperUser,
    isDeactivated = false,
    lastTaskTypeId = None
  )

  def insert: Fox[Unit] =
    for {
      _ <- insertLocalDataStoreIfEnabled
      _ <- insertLocalTracingStoreIfEnabled
      _ <- assertInitialDataEnabled
      _ <- assertNoOrganizationsPresent
      _ <- insertOrganization
      _ <- insertTeams
      _ <- insertDefaultUser
      _ <- insertToken
      _ <- insertTaskType
      _ <- insertProject
    } yield ()

  def assertInitialDataEnabled =
    for {
      _ <- bool2Fox(conf.Application.insertInitialData) ?~> "initialData.notEnabled"
    } yield ()

  def assertNoOrganizationsPresent =
    for {
      organizations <- organizationDAO.findAll
      _ <- bool2Fox(organizations.isEmpty) ?~> "initialData.organizationsNotEmpty"
    } yield ()

  def insertDefaultUser =
    userService.defaultUser.futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        for {
          _ <- userDAO.insertOne(defaultUser)
          _ <- userExperiencesDAO.updateExperiencesForUser(defaultUser._id, Map("sampleExp" -> 10))
          _ <- userTeamRolesDAO.insertTeamMembership(defaultUser._id, TeamMembership(organizationTeam._id, true))
          _ = logger.info("Inserted default user scmboy")
        } yield ()
    }.toFox

  def insertToken = {
    val expiryTime = conf.Silhouette.TokenAuthenticator.authenticatorExpiry.toMillis
    tokenDAO.findOneByLoginInfo("credentials", defaultUserEmail, TokenType.Authentication).futureBox.flatMap {
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
        tokenDAO.insertOne(newToken)
    }
  }

  def insertOrganization =
    organizationDAO
      .findOneByName(defaultOrganization.name)
      .futureBox
      .flatMap {
        case Full(_) => Fox.successful(())
        case _ =>
          organizationDAO.insertOne(defaultOrganization)
      }
      .toFox

  def insertTeams =
    teamDAO.findAll.flatMap { teams =>
      if (teams.isEmpty)
        teamDAO.insertOne(organizationTeam)
      else
        Fox.successful(())
    }.toFox

  def insertTaskType =
    taskTypeDAO.findAll.flatMap { types =>
      if (types.isEmpty) {
        val taskType = TaskType(
          ObjectId.generate,
          organizationTeam._id,
          "sampleTaskType",
          "Check those cells out!"
        )
        for { _ <- taskTypeDAO.insertOne(taskType) } yield ()
      } else Fox.successful(())
    }.toFox

  def insertProject =
    projectDAO.findAll.flatMap { projects =>
      if (projects.isEmpty) {
        userService.defaultUser.flatMap { user =>
          val project = Project(ObjectId.generate,
                                organizationTeam._id,
                                user._id,
                                "sampleProject",
                                100,
                                false,
                                Some(5400000),
                                false)
          for { _ <- projectDAO.insertOne(project) } yield ()
        }
      } else Fox.successful(())
    }.toFox

  def insertLocalDataStoreIfEnabled: Fox[Any] =
    if (conf.Datastore.enabled) {
      dataStoreDAO.findOneByName("localhost").futureBox.map { maybeStore =>
        if (maybeStore.isEmpty) {
          logger.info("inserting local datastore");
          dataStoreDAO.insertOne(DataStore("localhost", conf.Http.uri, conf.Datastore.key))
        }
      }
    } else Fox.successful(())

  def insertLocalTracingStoreIfEnabled: Fox[Any] =
    if (conf.Tracingstore.enabled) {
      tracingStoreDAO.findOneByName("localhost").futureBox.map { maybeStore =>
        if (maybeStore.isEmpty) {
          logger.info("inserting local tracingstore");
          tracingStoreDAO.insertOne(TracingStore("localhost", conf.Http.uri, conf.Tracingstore.key))
        }
      }
    } else Fox.successful(())
}
