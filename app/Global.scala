import akka.actor.Props
import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.mail.Mailer
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, GlobalDBAccess}
import com.scalableminds.util.security.SCrypt
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import models.binary._
import models.task._
import models.team._
import models.user._
import net.liftweb.common.Full
import oxalis.cleanup.CleanUpService
import oxalis.jobs.AvailableTasksJob
import oxalis.mturk.MTurkNotificationReceiver
import play.api._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.concurrent._
import play.api.libs.json.Json
import play.api.mvc._

import scala.concurrent.duration._

object Global extends GlobalSettings with LazyLogging{

  override def onStart(app: Application) {
    val conf = app.configuration

    logger.info("Executing Global START")
    startActors(conf.underlying, app)

    if (conf.getBoolean("application.insertInitialData") getOrElse false) {
      InitialData.insert(conf)
    }

    CleanUpService.register("deletion of expired dataTokens", UserToken.expirationTime) {
      UserTokenDAO.removeExpiredTokens()(GlobalAccessContext).map(r => s"deleted ${r.n}")
    }

    CleanUpService.register("deletion of openAssignments with zero instances", OpenAssignment.pruningInterval) {
      OpenAssignmentDAO.removeZeroInstanceAssignments()(GlobalAccessContext).map(r => s"deleted ${r.n}")
    }

    super.onStart(app)
  }

  def startActors(conf: Config, app: Application) {

    Akka.system(app).actorOf(
      Props(new Mailer(conf)),
      name = "mailActor")

    // We need to delay the start of the notification handle, since the database needs to be available first
    MTurkNotificationReceiver.startDelayed(app, 2.seconds)

    if (conf.getBoolean("workload.active")) {
      Akka.system(app).actorOf(
        Props(new AvailableTasksJob()),
        name = "availableTasksMailActor"
      )
    }
  }

  override def onError(request: RequestHeader, ex: Throwable) = {
    NewRelic.noticeError(ex)
    super.onError(request, ex)
  }
}

/**
 * Initial set of data to be imported
 * in the sample application.
 */
object InitialData extends GlobalDBAccess with LazyLogging {

  val mpi = Team("Connectomics department", None, RoleService.roles)

  def insert(conf: Configuration) = {
    insertDefaultUser(conf)
    insertTeams()
    insertTasks()
    if (conf.getBoolean("datastore.enabled").getOrElse(true)) {
      insertLocalDataStore(conf)
    }
  }

  def insertDefaultUser(conf: Configuration) = {
    UserService.defaultUser.futureBox.map {
      case Full(_) =>
      case _ =>
        val email = conf.getString("application.authentication.defaultUser.email").getOrElse("scmboy@scalableminds.com")
        val password = conf.getString("application.authentication.defaultUser.password").getOrElse("secret")
        logger.info("Inserted default user scmboy")
        UserDAO.insert(User(
          email,
          "SCM",
          "Boy",
          true,
          SCrypt.hashPassword(password),
          SCrypt.md5(password),
          List(TeamMembership(mpi.name, Role.Admin)))
        )
    }
  }

  def insertTeams() = {
    TeamDAO.findOne().futureBox.map {
      case Full(_) =>
      case _ =>
        TeamDAO.insert(mpi)
    }
  }

  def insertTasks() = {
    TaskTypeDAO.findAll.map {
      types =>
        if (types.isEmpty) {
          val taskType = TaskType(
            "ek_0563_BipolarCells",
            "Check those cells out!",
            mpi.name)
          TaskTypeDAO.insert(taskType)
        }
    }
  }

  def insertLocalDataStore(conf: Configuration) = {
    DataStoreDAO.findOne(Json.obj("name" -> "localhost")).futureBox.map { maybeStore =>
      if (maybeStore.isEmpty) {
        val url = conf.getString("http.uri").getOrElse("http://localhost:9000")
        DataStoreDAO.insert(DataStore("localhost", url, WebKnossosStore, "something-secure"))
      }
    }
  }
}
