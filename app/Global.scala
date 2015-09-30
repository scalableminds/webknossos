import akka.actor.Props
import com.scalableminds.util.reactivemongo.GlobalDBAccess
import com.scalableminds.util.security.SCrypt
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

    conf.getConfig("application.initialData").map{ initialDataConf ⇒
      if (initialDataConf.getBoolean("enabled") getOrElse false) {
        new InitialData(initialDataConf).insert()
      }
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
class InitialData(conf: Configuration) extends GlobalDBAccess {
  // Check if scm's default user should be added
  val shouldInsertSCMBoy = conf.getBoolean("insertSCMBoy") getOrElse false

  // Define default team for the inserted data
  val DefaultTeam = Team(conf.getString("defaultTeam").get, None, RoleService.roles)

  /**
   * Populate the DB with predefined data
   */
  def insert(): Unit = {
    insertUsers()
    insertTeams()
    insertTasks()
    insertLocalDataStore()
  }

  /**
   * Insert a single user into the database
   * @param firstName users firstname
   * @param lastName users lastname
   * @param email users email
   * @param role role of user
   */
  def insertSingleUser(firstName: String, lastName: String, email: String, role: Role): Unit = {
    UserDAO.findOneByEmail(email).futureBox.map {
      case Full(_) =>
      case _ =>
        Logger.info(s"Inserted user '$firstName $lastName'")
        UserDAO.insert(User(
          email,
          firstName,
          lastName,
          true,
          SCrypt.hashPassword("secret"),
          SCrypt.md5("secret"),
          List(TeamMembership(DefaultTeam.name, role)),
          UserSettings.defaultSettings,
          experiences = Map("trace-experience" -> 2)))
    }
  }

  /**
   * Insert predefined users into DB
   */
  def insertUsers(): Unit = {
    if(shouldInsertSCMBoy)
      insertSingleUser("SCM", "Boy", "scmboy@scalableminds.com", Role.Admin)

    insertSingleUser("SCM", "Admin", "scmadmin@scalableminds.com", Role.Admin)

    for (i <- 1 to 5){
      val lastName = s"aUser$i"
      val mailAddress = lastName.toLowerCase
      val mailDomain = DefaultTeam.name.replaceAll(" ","_").toLowerCase + ".net"
	    insertSingleUser("mpi", lastName, s"$mailAddress@$mailDomain", Role.User)
	  }
  }

  /**
   * Insert default team into DB if it doesn't exist
   */
  def insertTeams(): Unit = {
    TeamDAO.findOne().futureBox.map {
      case Full(_) =>
      case _ =>
        TeamDAO.insert(DefaultTeam)
    }
  }

  /**
   * Add some tasks to the DB if there are none
   */
  def insertTasks(): Unit = {
    TaskTypeDAO.findAll.map {
      types =>
        if (types.isEmpty) {
          val taskType = TaskType(
            "ek_0563_BipolarCells",
            "Check those cells out!",
            TraceLimit(5, 10, 15),
            DefaultTeam.name)
          TaskTypeDAO.insert(taskType)
        }
    }
  }

  /**
   * Insert the local datastore into the database
   */
  def insertLocalDataStore(): Unit = {
    DataStoreDAO.findOne(Json.obj("name" -> "localhost")).futureBox.map { maybeStore =>
      if (maybeStore.isEmpty) {
        DataStoreDAO.insert(DataStore("localhost", "", "something-secure"))
      }
    }
  }
}
