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
  val rootTeamName = "Connectomics department"

  def insert: Fox[Unit] =
    for {
      _ <- insertDefaultUser
      _ <- insertRootTeam
      _ <- giveDefaultUserTeam
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
          List(),
          loginInfo = UserService.createLoginInfo(email),
          passwordInfo = UserService.createPasswordInfo(password),
          experiences = Map("sampleExp" -> 10),
          _isSuperUser = Play.configuration.getBoolean("application.authentication.defaultUser.isSuperUser"))
        )
    }
  }

  def insertRootTeam = {
    TeamDAO.findOneByName(rootTeamName).futureBox.flatMap {
      case Full(_) => Fox.successful(())
      case _ =>
        UserService.defaultUser.flatMap(user => TeamDAO.insert(Team(rootTeamName, None, RoleService.roles, user._id)))
    }
  }

  def giveDefaultUserTeam = {
    UserService.defaultUser.flatMap { user =>
      if (!user.teamNames.contains(rootTeamName)) {
        UserDAO.addTeam(user._id, TeamMembership(rootTeamName, Role.Admin))
      } else Fox.successful(())
    }
  }

  def insertTaskType = {
    TaskTypeDAO.findAll.map {
      types =>
        if (types.isEmpty) {
          val taskType = TaskType(
            "sampleTaskType",
            "Check those cells out!",
            rootTeamName)
          TaskTypeDAO.insert(taskType)
        }
    }
  }

  def insertProject = {
    ProjectDAO.findAll.map {
      projects =>
        if (projects.isEmpty) {
          UserService.defaultUser.flatMap { user =>
            val project = Project("sampleProject", rootTeamName, user._id, 100, false, Some(5400000))
            ProjectDAO.insert(project)
          }
        }
    }
  }

  def insertLocalDataStore: Fox[Any] = {
    DataStoreDAO.findOneByName("localhost").futureBox.map { maybeStore =>
      if (maybeStore.isEmpty) {
        val url = Play.configuration.getString("http.uri").getOrElse("http://localhost:9000")
        val key = Play.configuration.getString("datastore.key").getOrElse("something-secure")
        DataStoreDAO.insert(DataStore("localhost", url, WebKnossosStore, key))
      }
    }
  }
}
