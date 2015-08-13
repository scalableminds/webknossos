import akka.actor.{PoisonPill, Props}
import com.scalableminds.util.reactivemongo.GlobalDBAccess
import com.scalableminds.util.security.SCrypt
import com.scalableminds.datastore.services.BinaryDataService
import models.binary.{DataStore, DataStoreDAO}
import models.team._
import net.liftweb.common.Full
import oxalis.jobs.AvailableTasksJob
import play.api._
import play.api.libs.concurrent._
import models.user._
import models.task._
import oxalis.annotation.{AnnotationStore}
import com.scalableminds.util.mail.Mailer
import play.api.libs.concurrent.Execution.Implicits._
import com.typesafe.config.Config
import play.airbrake.Airbrake
import com.kenshoo.play.metrics._
import com.codahale.metrics.JmxReporter
import play.api.libs.json.Json
import play.api.mvc._

object Global extends WithFilters(MetricsFilter) with GlobalSettings {

  override def onStart(app: Application) {
    val conf = app.configuration

    startJMX()

    startActors(conf.underlying, app)

    if (conf.getBoolean("application.insertInitialData") getOrElse false) {
      InitialData.insert()
    }
    super.onStart(app)
  }

  def startJMX() = {
    JmxReporter
      .forRegistry(MetricsRegistry.default)
      .build
      .start
  }

  def startActors(conf: Config, app: Application) {
    Akka.system(app).actorOf(
      Props(new AnnotationStore()),
      name = "annotationStore")

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

  override def onError(request: RequestHeader, ex: Throwable) = {
    Airbrake.notify(request, ex)
    super.onError(request, ex)
  }
}

/**
 * Initial set of data to be imported
 * in the sample application.
 */
object InitialData extends GlobalDBAccess {

  val mpi = Team("Connectomics department", None, RoleService.roles)

  def insert() = {
    insertUsers()
    insertTeams()
    insertTasks()
    insertLocalDataStore()
  }

  def insertUsers() = {
    UserDAO.findOneByEmail("scmboy@scalableminds.com").futureBox.map {
      case Full(_) =>
      case _ =>
        Logger.info("Inserted default user scmboy")
        UserDAO.insert(User(
          "scmboy@scalableminds.com",
          "SCM",
          "Boy",
          true,
          SCrypt.hashPassword("secret"),
          SCrypt.md5("secret"),
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
            TraceLimit(5, 10, 15),
            mpi.name)
          TaskTypeDAO.insert(taskType)
        }
    }
  }

  def insertLocalDataStore() = {
    DataStoreDAO.findOne(Json.obj("name" -> "localhost")).futureBox.map { maybeStore =>
      if (maybeStore.isEmpty) {
        DataStoreDAO.insert(DataStore("localhost", "", "something-secure"))
      }
    }
  }

}
