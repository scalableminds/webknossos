import akka.actor.Props
import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.mail.Mailer
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, GlobalDBAccess}
import com.scalableminds.util.security.SCrypt
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import models.binary._
import models.project.{Project, ProjectDAO}
import models.task.{TaskType, TaskTypeDAO}
import models.team._
import models.user._
import net.liftweb.common.{Failure, Full}
import oxalis.cleanup.CleanUpService
import oxalis.jobs.AvailableTasksJob
import oxalis.security.WebknossosSilhouette
import play.api.Play.current
import play.api._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.concurrent._
import play.api.mvc.Results.Ok
import play.api.mvc._
import reactivemongo.bson.BSONObjectID
import utils.SQLClient

import scala.concurrent.Future
import sys.process._

object Global extends GlobalSettings with LazyLogging{

  override def onStart(app: Application) {
    val conf = app.configuration

    logger.info("Executing Global START")
    startActors(conf.underlying, app)

    ensurePostgresDatabase.onComplete { _ =>
      if (conf.getBoolean("application.insertInitialData") getOrElse false) {
        InitialData.insert.futureBox.map {
          case Full(_) => ()
          case Failure(msg, _, _) => logger.error("Error while inserting initial data: " + msg)
          case _ => logger.error("Error while inserting initial data")
        }
      }
    }

    val tokenAuthenticatorService = WebknossosSilhouette.environment.combinedAuthenticatorService.tokenAuthenticatorService

    CleanUpService.register("deletion of expired tokens", tokenAuthenticatorService.dataStoreExpiry) {
      tokenAuthenticatorService.removeExpiredTokens(GlobalAccessContext)
    }

    super.onStart(app)
  }

  override def onStop(app: Application): Unit = {
    logger.info("Executing Global END")

    logger.info("Closing SQL Database handle")
    SQLClient.db.close()

    super.onStop(app)
  }

  def startActors(conf: Config, app: Application) {

    Akka.system(app).actorOf(
      Props(new Mailer(conf)),
      name = "mailActor")

    if (conf.getBoolean("workload.active")) {
      Akka.system(app).actorOf(
        Props(new AvailableTasksJob()),
        name = "availableTasksMailActor"
      )
    }
  }

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.onRouteRequest(request)
    } else {
      Some(Action {Ok(views.html.main())})
    }
  }

  override def onError(request: RequestHeader, ex: Throwable) = {
    NewRelic.noticeError(ex)
    super.onError(request, ex)
  }

  def ensurePostgresDatabase = {
    logger.info("Running ensure_db.sh with POSTGRES_URL " + sys.env.get("POSTGRES_URL"))

    val processLogger = ProcessLogger(
      (o: String) => logger.info(o),
      (e: String) => logger.error(e))

    // this script is copied to the stage directory in AssetCompilation
    val result = "./tools/postgres/ensure_db.sh" ! processLogger

    if (result != 0)
      throw new Exception("Could not ensure Postgres database. Is postgres installed?")

    Future.successful(())
  }

}


/**
  * Initial set of data to be imported
  * in the sample application.
  */
object InitialData extends GlobalDBAccess with FoxImplicits with LazyLogging {

  val defaultUserEmail = Play.configuration.getString("application.authentication.defaultUser.email").getOrElse("scmboy@scalableminds.com")
  val defaultUserPassword = Play.configuration.getString("application.authentication.defaultUser.password").getOrElse("secret")

  val organizationTeamId = BSONObjectID.generate
  val defaultOrganization = Organization("Connectomics department", List(), organizationTeamId)
  val organizationTeam = Team(defaultOrganization.name, defaultOrganization.name, organizationTeamId)

  def insert: Fox[Unit] =
    for {
      _ <- insertOrganization
      _ <- insertTeams
      _ <- insertDefaultUser
      _ <- insertTaskType
      _ <- insertProject
      _ <- if (Play.configuration.getBoolean("datastore.enabled").getOrElse(true)) insertLocalDataStore else Fox.successful(())
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
        )(GlobalAccessContext)
    }.toFox
  }

  def insertOrganization = {
    OrganizationDAO.findOneByName(defaultOrganization.name)(GlobalAccessContext).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        OrganizationDAO.insert(defaultOrganization)(GlobalAccessContext)
    }.toFox
  }

  def insertTeams = {
    TeamDAO.findAll(GlobalAccessContext).flatMap {
      teams =>
        if (teams.isEmpty)
          TeamDAO.insert(organizationTeam)(GlobalAccessContext)
        else
          Fox.successful(())
    }.toFox
  }

  def insertTaskType = {
    TaskTypeDAO.findAll(GlobalAccessContext).flatMap {
      types =>
        if (types.isEmpty) {
          val taskType = TaskType(
            "sampleTaskType",
            "Check those cells out!",
            organizationTeam._id)
          for {_ <- TaskTypeDAO.insert(taskType)(GlobalAccessContext)} yield ()
        }
        else Fox.successful(())
    }.toFox
  }

  def insertProject = {
    ProjectDAO.findAll(GlobalAccessContext).flatMap {
      projects =>
        if (projects.isEmpty) {
          UserService.defaultUser.flatMap { user =>
            val project = Project("sampleProject", organizationTeam._id, user._id, 100, false, Some(5400000))
            for {_ <- ProjectDAO.insert(project)(GlobalAccessContext)} yield ()
          }
        } else Fox.successful(())
    }.toFox
  }

  def insertLocalDataStore: Fox[Any] = {
    DataStoreDAO.findOneByName("localhost")(GlobalAccessContext).futureBox.map { maybeStore =>
      if (maybeStore.isEmpty) {
        val url = Play.configuration.getString("http.uri").getOrElse("http://localhost:9000")
        val key = Play.configuration.getString("datastore.key").getOrElse("something-secure")
        DataStoreDAO.insert(DataStore("localhost", url, WebKnossosStore, key))
      }
    }
  }
}
