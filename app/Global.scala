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
  
  /**
   * Populate the DB with predefined data
   */
  def insert(): Unit = {
    if (manyTeams)
      for (i <- 1 to 5)
        insertPerTeam(Team("Team " + i.toString(), None, RoleService.roles),i)
    else
      insertPerTeam(DefaultTeam,1)
    insertLocalDataStore()
  }
  def insertPerTeam(team: Team, teamNum: int) : Unit = {
    TeamDAO.insert(team)
    val users = insertUsers(team, teamNum) // user 0 is admin
    val taskTypes = insertTaskTypes(team)
    val task = insertTask(taskTypes(2), 
      "retina",
      1,
      100,
      2,
      team,
      projects(0), 
      "100527_k0563",
      [388, 2855, 4151],
      [0, 0, 0, 0, 0, 0])
    val annotation = Annotation(task,"public/nmls/alles_2_trees_corrected_094_1_8_633_fkramer_002.038.nml", finished=True)
    add_e2006(users, team, taskTypes(2))
  }  
  
  def add_e2006 (users:Array[User], team:Team, taskType:TaskType) : Unit = {
    int counter = 0
    val project = insertProject(team, users(0), "e2006_allcells")
    for (file <- new File("public/nmls/e2006/").listFiles) { 
      coords=file.fileName.split("_")
      val task=insertTask(taskType
        "retina",
        1,
        100,
        1,
        team,
        project,
        "e2006",
        [coords(3), coords(4), coords(5)].toInt(),
        [0, 0, 0, 0, 0, 0])
        insertAnnotation(task,users(counter%5+1))
      counter += 1
    }
  }
  /**
   * Insert a single user into the database
   * @param firstName users firstname
   * @param lastName users lastname
   * @param email users email
   * @param role role of user
   */
  def insertSingleUser(firstName: String, lastName: String, email: String, role: Role,team: Team, password: String, experienceList: Something): User = {
    UserDAO.findOneByEmail(email).futureBox.map {
      case Full(_) =>
      case _ =>
        Logger.info(s"Inserted user '$firstName $lastName' with password $password")
        val user = User(
          email,
          firstName,
          lastName,
          true,
          SCrypt.hashPassword(password),
          SCrypt.md5(password),
          List(TeamMembership(team.name, role)),
          UserSettings.defaultSettings,
          experiences = experienceList
        UserDAO.insert(user)
        return user
    }
  }

  /**
   * Insert predefined users into DB
   */
  def insertUsers(team: Team, teamNumber: int): User = {
    var users:Array[User] = Array[User](11)
    val r =  scala.util.Random
    val lastName = "WebKnossos"
    val firstName = "Admin " + teamNumber.toString()
    val mailAddress = "admin" + teamNumber.toString()
    val mailDomain = "webknossos.org"
    val password = r.nextPrintableChar() + r.nextPrintableChar() + r.nextPrintableChar() + r.nextPrintableChar() + r.nextPrintableChar() //Sorryy
    if(shouldInsertSCMBoy) {
      users(0) = insertSingleUser("SCM", "Boy", "scmboy@scalableminds.com", Role.Admin,DefaultTeam, secret)
    } else {
      users(0)=insertSingleUser(firstName, lastName, s"$mailAddress@$mailDomain", Role.Admin,teams(i-1))
    }
    for (j <- 1 to 5) {
      val firstNameUser = "User " + teamNumber.toString() + j.toString()
      val mailAddressUser = "user" + teamNumber.toString() + j.toString()
      users(j) = insertSingleUser(firstNameUser, lastName, s"$mailAddressUser@$mailDomain", Role.User,team, password,Map("retina" -> 1)))
    }
    for (j <- 6 to 10) {
      val firstNameUser = "User " + teamNumber.toString() + j.toString()
      val mailAddressUser = "user" + teamNumber.toString() + j.toString()
      users(j) = insertSingleUser(firstNameUser, lastName, s"$mailAddressUser@$mailDomain", Role.User,team, password)
    }
    return users
  }
  
  /**
   * Add a task
   */
  def insertTask(taskType: TaskType, experienceDomain: String, experienceLevel: Int, priority: Int, taskInstances: Int, team:Team, project:Project, dataset: String, start: Array[Int], boundingBox: Array[Int]): Task = {
    val task=Task(taskType, experienceDomain, experienceLevel, priority, taskInstances, team, project, dataset,start,boundingBox)
    TaskDAO.insert(task)
    return task
  } 

  def insertTaskTypesPerTeam(team: Team): Array[TaskType = {
    var taskTypes:Array[TaskType] = new Array[TaskType](4)
    val noOtherModes=[false, false]
    val yesOtherModes=[true, true]
    taskTypes(0) = TaskType(
      "orthogonalLong",
      "Please use only orthogonal mode",
      TraceLimit(5, 10, 20),
      noOtherModes,
      team.name)
    taskTypes(1) = TaskType(
      "orthogonalShort",
      "Please use only orthogonal mode and don't take too long",
      TraceLimit(5, 10, 10),
      noOtherModes,
      team.name)
    taskTypes(2) = TaskType(
      "allModesLong",
      "Use any mode",
      TraceLimit(5, 10, 20),
      yesOtherModes,
      team.name)
    taskTypes(3) = TaskType(
      "allModesShort",
      "Use any mode and don't take too long",
      TraceLimit(5, 10, 10),
      yesOtherModes,
      team.name)
    for (i <- 0 to 3) 
      TaskTypeDAO.insert(taskTypes(i))
    return taskTypes
  }
  def insertProject(team: Team, owner: User, name: String): Project ={
    val project = Project(team,owner,name)
    ProjectDAO.insert(project)
    return project
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
