package controllers

import com.mohiva.play.silhouette.api.{LoginInfo, Silhouette}
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{TracingStore, TracingStoreDAO}
import models.binary._
import models.project.{Project, ProjectDAO}
import models.task.{TaskType, TaskTypeDAO}
import models.team._
import models.user._
import net.liftweb.common.{Box, Full}
import org.joda.time.DateTime
import oxalis.security._
import play.api.libs.json.Json
import utils.{ObjectId, StoreModules, WkConf}
import javax.inject.Inject
import models.organization.{Organization, OrganizationDAO}
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class InitialDataController @Inject()(initialDataService: InitialDataService, sil: Silhouette[WkEnv])(
    implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def triggerInsert: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      _ <- initialDataService.insert
    } yield Ok
  }
}

class InitialDataService @Inject()(userService: UserService,
                                   userDAO: UserDAO,
                                   multiUserDAO: MultiUserDAO,
                                   userTeamRolesDAO: UserTeamRolesDAO,
                                   userExperiencesDAO: UserExperiencesDAO,
                                   taskTypeDAO: TaskTypeDAO,
                                   dataStoreDAO: DataStoreDAO,
                                   tracingStoreDAO: TracingStoreDAO,
                                   teamDAO: TeamDAO,
                                   tokenDAO: TokenDAO,
                                   projectDAO: ProjectDAO,
                                   publicationDAO: PublicationDAO,
                                   organizationDAO: OrganizationDAO,
                                   storeModules: StoreModules,
                                   conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {
  implicit val ctx: GlobalAccessContext.type = GlobalAccessContext

  private val defaultUserEmail = conf.WebKnossos.SampleOrganization.User.email
  private val defaultUserPassword = conf.WebKnossos.SampleOrganization.User.password
  private val defaultUserToken = conf.WebKnossos.SampleOrganization.User.token
  private val additionalInformation = """**Sample Organization**

Sample Street 123
Sampletown
Samplecountry
"""
  private val organizationTeamId = ObjectId.generate
  private val defaultOrganization =
    Organization(ObjectId.generate,
                 "sample_organization",
                 additionalInformation,
                 "/assets/images/oxalis.svg",
                 "Sample Organization",
                 PricingPlan.Custom)
  private val organizationTeam =
    Team(organizationTeamId, defaultOrganization._id, defaultOrganization.name, isOrganizationTeam = true)
  private val userId = ObjectId.generate
  private val multiUserId = ObjectId.generate
  private val defaultMultiUser = MultiUser(
    multiUserId,
    defaultUserEmail,
    userService.createPasswordInfo(defaultUserPassword),
    isSuperUser = conf.WebKnossos.SampleOrganization.User.isSuperUser,
  )
  private val defaultUser = User(
    userId,
    multiUserId,
    defaultOrganization._id,
    "SCM",
    "Boy",
    System.currentTimeMillis(),
    Json.obj(),
    userService.createLoginInfo(userId),
    isAdmin = true,
    isDatasetManager = true,
    isUnlisted = false,
    isDeactivated = false,
    lastTaskTypeId = None
  )
  private val defaultPublication = Publication(
    ObjectId("5c766bec6c01006c018c7459"),
    Some(System.currentTimeMillis()),
    Some("https://static.webknossos.org/images/oxalis.svg"),
    Some("Dummy Title that is usually very long and contains highly scientific terms"),
    Some(
      "This is a wonderful dummy publication, it has authors, it has a link, it has a doi number, those could go here.\nLorem [ipsum](https://github.com/scalableminds/webknossos) dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua.")
  )

  def insert: Fox[Unit] =
    for {
      _ <- updateLocalDataStorePublicUri()
      _ <- updateLocalTracingStorePublicUri()
      _ <- insertLocalDataStoreIfEnabled()
      _ <- insertLocalTracingStoreIfEnabled()
      _ <- assertInitialDataEnabled
      _ <- assertNoOrganizationsPresent
      _ <- insertOrganization()
      _ <- insertTeams()
      _ <- insertDefaultUser()
      _ <- insertToken()
      _ <- insertTaskType()
      _ <- insertProject()
      _ <- insertPublication()
    } yield ()

  private def assertInitialDataEnabled: Fox[Unit] =
    for {
      _ <- bool2Fox(conf.WebKnossos.SampleOrganization.enabled) ?~> "initialData.notEnabled"
    } yield ()

  def assertNoOrganizationsPresent: Fox[Unit] =
    for {
      organizations <- organizationDAO.findAll
      _ <- bool2Fox(organizations.isEmpty) ?~> "initialData.organizationsNotEmpty"
    } yield ()

  private def insertDefaultUser(): Fox[Unit] =
    userService
      .userFromMultiUserEmail(defaultUserEmail)
      .futureBox
      .flatMap {
        case Full(_) => Fox.successful(())
        case _ =>
          for {
            _ <- multiUserDAO.insertOne(defaultMultiUser)
            _ <- userDAO.insertOne(defaultUser)
            _ <- userExperiencesDAO.updateExperiencesForUser(defaultUser, Map("sampleExp" -> 10))
            _ <- userTeamRolesDAO.insertTeamMembership(defaultUser._id,
                                                       TeamMembership(organizationTeam._id, isTeamManager = true))
            _ = logger.info("Inserted default user scmboy")
          } yield ()
      }
      .toFox

  private def insertToken(): Fox[Unit] = {
    val expiryTime = conf.Silhouette.TokenAuthenticator.authenticatorExpiry.toMillis
    tokenDAO.findOneByLoginInfo("credentials", defaultUser._id.id, TokenType.Authentication).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        val newToken = Token(
          ObjectId.generate,
          defaultUserToken,
          LoginInfo("credentials", defaultUser._id.id),
          new DateTime(System.currentTimeMillis()),
          new DateTime(System.currentTimeMillis() + expiryTime),
          None,
          TokenType.Authentication
        )
        tokenDAO.insertOne(newToken)
    }
  }

  private def insertOrganization(): Fox[Unit] =
    organizationDAO
      .findOneByName(defaultOrganization.name)
      .futureBox
      .flatMap {
        case Full(_) => Fox.successful(())
        case _ =>
          organizationDAO.insertOne(defaultOrganization)
      }
      .toFox

  private def insertTeams(): Fox[Unit] =
    teamDAO.findAll.flatMap { teams =>
      if (teams.isEmpty)
        teamDAO.insertOne(organizationTeam)
      else
        Fox.successful(())
    }.toFox

  private def insertTaskType(): Fox[Unit] =
    taskTypeDAO.findAll.flatMap { types =>
      if (types.isEmpty) {
        val taskType = TaskType(
          ObjectId.generate,
          organizationTeam._id,
          "sampleTaskType",
          "Check those cells out!"
        )
        for { _ <- taskTypeDAO.insertOne(taskType, defaultOrganization._id) } yield ()
      } else Fox.successful(())
    }.toFox

  private def insertProject(): Fox[Unit] =
    projectDAO.findAll.flatMap { projects =>
      if (projects.isEmpty) {
        userService.userFromMultiUserEmail(defaultUserEmail).flatMap { user =>
          val project = Project(ObjectId.generate,
                                organizationTeam._id,
                                user._id,
                                "sampleProject",
                                100,
                                paused = false,
                                Some(5400000),
                                isBlacklistedFromReport = false)
          for { _ <- projectDAO.insertOne(project, defaultOrganization._id) } yield ()
        }
      } else Fox.successful(())
    }.toFox

  private def insertPublication(): Fox[Unit] = publicationDAO.findAll.flatMap { publications =>
    if (publications.isEmpty) {
      publicationDAO.insertOne(defaultPublication)
    } else Fox.successful(())
  }

  def insertLocalDataStoreIfEnabled(): Fox[Unit] =
    if (storeModules.localDataStoreEnabled) {
      dataStoreDAO.findOneByUrl(conf.Http.uri).futureBox.flatMap { maybeStore =>
        if (maybeStore.isEmpty) {
          logger.info("Inserting local datastore")
          dataStoreDAO.insertOne(
            DataStore(conf.Datastore.name,
                      conf.Http.uri,
                      conf.Datastore.publicUri.getOrElse(conf.Http.uri),
                      conf.Datastore.key,
                      jobsEnabled = conf.Features.jobsEnabled))
        } else Fox.successful(())
      }
    } else Fox.successful(())

  private def insertLocalTracingStoreIfEnabled(): Fox[Unit] =
    if (storeModules.localTracingStoreEnabled) {
      tracingStoreDAO.findOneByUrl(conf.Http.uri).futureBox.flatMap { maybeStore =>
        if (maybeStore.isEmpty) {
          logger.info("Inserting local tracingstore")
          tracingStoreDAO.insertOne(
            TracingStore(conf.Tracingstore.name,
                         conf.Http.uri,
                         conf.Tracingstore.publicUri.getOrElse(conf.Http.uri),
                         conf.Tracingstore.key))
        } else Fox.successful(())
      }
    } else Fox.successful(())

  private def updateLocalDataStorePublicUri(): Fox[Unit] =
    if (storeModules.localDataStoreEnabled) {
      dataStoreDAO.findOneByUrl(conf.Http.uri).futureBox.flatMap { storeOpt: Box[DataStore] =>
        storeOpt match {
          case Full(store) =>
            val newPublicUri = conf.Datastore.publicUri.getOrElse(conf.Http.uri)
            if (store.publicUrl == newPublicUri) {
              Fox.successful(())
            } else dataStoreDAO.updateOne(store.copy(publicUrl = newPublicUri))
          case _ => Fox.successful(())
        }
      }
    } else Fox.successful(())

  private def updateLocalTracingStorePublicUri(): Fox[Unit] =
    if (storeModules.localTracingStoreEnabled) {
      tracingStoreDAO.findOneByUrl(conf.Http.uri).futureBox.flatMap { storeOpt: Box[TracingStore] =>
        storeOpt match {
          case Full(store) =>
            val newPublicUri = conf.Tracingstore.publicUri.getOrElse(conf.Http.uri)
            if (store.publicUrl == newPublicUri) {
              Fox.successful(())
            } else tracingStoreDAO.updateOne(store.copy(publicUrl = newPublicUri))
          case _ => Fox.successful(())
        }
      }
    } else Fox.successful(())
}
