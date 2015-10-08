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
import java.io.File
import scala.concurrent.Future
import scala.concurrent._
import scala.concurrent.duration._
import models.annotation._

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
  def insert() {
    if (manyTeams)
      for (i <- 1 to 5)
        insertPerTeam(Team(s"Team $i", None, RoleService.roles), i)
    else
      insertPerTeam(DefaultTeam, 1)
    insertLocalDataStore()
  }

  def insertPerTeam(team: Team, teamNum: Int) {
    TeamDAO.insert(team)
    val users = insertUsers(team, teamNum) // user 0 is admin
    val taskTypes = insertTaskTypesPerTeam(team)
    add_e2006(users, team, taskTypes(2))
    add_ek0563(users, team, taskTypes)
    add_cortex(users, team, taskTypes)// was add_cortex(users, team, taskTypes(2))
    add_lm(users, team, taskTypes)
  }

  def add_e2006(users: Array[User], team: Team, taskType: TaskType) {
    var counter = 0
    val project = insertProject(team, users(0), "e2006_allcells")

    for (file <- new File("public/nmls/e2006/").listFiles) {
      val coords = file.getName.split("_")
      val task = insertTask(
        taskType,
        "retina",
        1,
        100,
        1,
        team,
        project,
        "e2006",
        coords.drop(3).take(3).map(_.toInt),
        Array.fill(6)(0))
      //insertAnnotation(file, task, users(counter % 5 + 1), finished = True) NOT DEFINED
      counter += 1
    }
  }

  def add_ek0563(users:Array[User], team: Team, taskTypes: Array[TaskType]) {
    var counter = 0
    for {
      typ <- List("finished", "unfinished")
      file <- new File(s"public/nmls/cortex/$typ/").listFiles
    } yield {
      // insertExplorativeAnnotation(file, users(counter % 11)) NOT DEFINED
      counter += 1
    }
  }

  def add_cortex(users:Array[User], team: Team, taskTypes: Array[TaskType]) {
    val project = insertProject(team, users(0), "cortex")
    var counter = 0
    for {
      typ <- List("finished", "unfinished")
      file <- new File(s"public/nmls/cortex/$typ/").listFiles
    } yield {
      val coords = file.getName.split("_")
      val task = insertTask(
        taskTypes(1),
        "cells_in_cortex",
        1,
        100,
        1,
        team,
        project,
        "2012-06-28_Cortex",
        coords.take(3).map(_.toInt),
        Array.fill(6)(0))
      //insertAnnotation(file, task, users(counter % 5 + 6), finished = typ == "finished") NOT DEFINED
      counter += 1
    }
  }

  def add_lm(users:Array[User], team: Team, taskTypes: Array[TaskType]) {
  }

  def insertSingleUser(firstName: String, lastName: String, email: String, role: Role,team: Team, password: String, experienceList: Map[String, Int]): User = {
    Await.result(UserDAO.findOneByEmail(email).futureBox.map {
      case Full(u) => u
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
        )
        UserDAO.insert(user)
        return user
    }, 5 seconds)
  }

  /**
   * Insert predefined users into DB
   */
  def insertUsers(team: Team, teamNumber: Int): Array[User] = {
    var users: Array[User] = Array.fill(11)(null)
    val r =  scala.util.Random
    val lastName = "WebKnossos"
    val firstName = s"Admin $teamNumber"
    val mailAddress = "admin$teamNumber"
    val mailDomain = "webknossos.org"
    val passwords = List("guywx","xaupd","ajsbp","crhkd","npfyf")
    val password = passwords(teamNumber - 1)

    if(shouldInsertSCMBoy) {
      users(0) = insertSingleUser("SCM", "Boy", "scmboy@scalableminds.com", Role.Admin, DefaultTeam, "secret", Map.empty) // <- welche Experiences sollen hier hin?
    } else {
      users(0) = insertSingleUser(firstName, lastName, s"$mailAddress@$mailDomain", Role.Admin, team, password, Map.empty) // <- welche Experiences sollen hier hin?
    }

    for (j <- 1 to 5) {
      val firstNameUser = s"User $teamNumber$j"
      val mailAddressUser = s"user$teamNumber$j"
      users(j) = insertSingleUser(firstNameUser, lastName, s"$mailAddressUser@$mailDomain", Role.User, team, password, Map("retina" -> 1))
    }

    for (j <- 6 to 10) {
      val firstNameUser = "User " + teamNumber.toString() + j.toString()
      val mailAddressUser = "user" + teamNumber.toString() + j.toString()
      users(j) = insertSingleUser(firstNameUser, lastName, s"$mailAddressUser@$mailDomain", Role.User, team, password, Map("cells_in_cortex" -> 1))
    }
    return users
  }

  /**
   * Add a task
   */
  def insertTask(taskType: TaskType, experienceDomain: String, experienceLevel: Int, priority: Int, taskInstances: Int, team: Team, project: Project, dataset: String, start: Array[Int], boundingBox: Array[Int]): Task = {
    // val task = Task(taskType._id, team.name, Experience(experienceDomain, experienceLevel), priority, taskInstances, 0, project, dataset,start,boundingBox)
    // I am not sure, what you tried to do here
    val task = Task(taskType._id, team.name, Experience(experienceDomain, experienceLevel), priority, taskInstances, 0, _project = Some(project.name))
    TaskDAO.insert(task)
    return task
  }

  def insertTaskTypesPerTeam(team: Team): Array[TaskType] = {
    var taskTypes: Array[TaskType] = new Array[TaskType](4)
    val noOtherModes = AnnotationSettings(allowedModes = List())
    val yesOtherModes = AnnotationSettings.default

    taskTypes(0) = TaskType(
      "orthogonalLong",
      "Please use only orthogonal mode",
      TraceLimit(5, 10, 20),
      team.name,
      noOtherModes)
    taskTypes(1) = TaskType(
      "orthogonalShort",
      "Please use only orthogonal mode and don't take too long",
      TraceLimit(5, 10, 10),
      team.name,
      noOtherModes)
    taskTypes(2) = TaskType(
      "allModesLong",
      "Use any mode",
      TraceLimit(5, 10, 20),
      team.name,
      yesOtherModes)
    taskTypes(3) = TaskType(
      "allModesShort",
      "Use any mode and don't take too long",
      TraceLimit(5, 10, 10),
      team.name,
      yesOtherModes)
    for (i <- 0 to 3)
      TaskTypeDAO.insert(taskTypes(i))
    return taskTypes
  }

  def insertProject(team: Team, owner: User, name: String): Project ={
    val project = Project(name, team.name, owner._id)
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
