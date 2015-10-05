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
import scala.util.Random
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
  val manyTeams = conf.getBoolean("manyTeams") getOrElse false
  // Define default team for the inserted data
  val DefaultTeam = Team(conf.getString("defaultTeam").get, None, RoleService.roles)
  var teams:Array[Team] = new Array[Team](5);
  /**
   * Populate the DB with predefined data
   */
  def insert(): Unit = {
    insertTeams()
    insertUsers()
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
  def insertSingleUser(firstName: String, lastName: String, email: String, role: Role,team: Team, password: String): Unit = {
    UserDAO.findOneByEmail(email).futureBox.map {
      val r =  scala.util.Random
      case Full(_) =>
      case _ =>
        var password : String
        if = 
        Logger.info(s"Inserted user '$firstName $lastName' with password $password")
        UserDAO.insert(User(
          email,
          firstName,
          lastName,
          true,
          SCrypt.hashPassword(password),
          SCrypt.md5(password),
          List(TeamMembership(team.name, role)),
          UserSettings.defaultSettings,
          experiences = Map("trace-experience" -> 2)))
    }
  }

  /**
   * Insert predefined users into DB
   */
  def insertUsers(): Unit = {
    if(shouldInsertSCMBoy)
      insertSingleUser("SCM", "Boy", "scmboy@scalableminds.com", Role.Admin,DefaultTeam, secret)
    if (manyTeams)
      for (i <- 1 to 5) {
        val lastName = "WebKnossos"
        val firstName = "Admin " + i.toString()
        val mailAddress = "admin" + i.toString()
        val mailDomain = "webknossos.org"
        val password = r.nextPrintableChar() + r.nextPrintableChar() + r.nextPrintableChar() + r.nextPrintableChar() + r.nextPrintableChar() //Sorryy
        insertSingleUser(firstName, lastName, s"$mailAddress@$mailDomain", Role.Admin,teams(i-1))
        for (j <- 1 to 5) {
          val firstName = "User " + i.toString() + j.toString()
          val mailAddress = "user" + i.toString() + j.toString()
          insertSingleUser(firstName, lastName, s"$mailAddress@$mailDomain", Role.User,teams(i-1), password)
        }
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
		if (manyTeams)
      teams(0)=DefaultTeam
		  for (i <- 2 to 5)
        teams(i-1)=Team("Team " + i.toString(), None, RoleService.roles)
			  TeamDAO.insert(teams(i-1))
        
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
