import akka.actor.Props
import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import com.scalableminds.util.reactivemongo.GlobalDBAccess
import com.scalableminds.util.security.SCrypt
import models.binary.{DataStore, DataStoreDAO}
import models.team._
import models.tracing.skeleton.SkeletonTracingService
import net.liftweb.common.Full
import oxalis.jobs.AvailableTasksJob
import oxalis.nml.NMLService
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
import models.user.time._

object Global extends WithFilters(MetricsFilter) with GlobalSettings {

  override def onStart(app: Application) {
    val conf = app.configuration

    startJMX()

    startActors(conf.underlying, app)

    conf.getConfig("application.initialData").map{ initialDataConf ⇒
      if (initialDataConf.getBoolean("enabled") getOrElse false) {
        Future {
          new InitialData(initialDataConf).insert()
        }
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

  type AdminUser = User
  // Check if scm's default user should be added
  val ShouldInsertSCMBoy = conf.getBoolean("insertSCMBoy") getOrElse false
  // Let's create as many teams as specified in the configuration
  val NumberOfTeams = conf.getInt("numberOfTeams") getOrElse 1
  // Define default team for the inserted data
  val DefaultTeam = Team(conf.getString("defaultTeam").get, None, RoleService.roles)

  val DefaultPasswords = List("guywx","xaupd","ajsbp","crhkd","npfyf")

  /**
   * Populate the DB with predefined data
   */
  def insert() {
    insertTeams()
    insertLocalDataStore()
  }

  def insertTeams(): Unit = {
    if (NumberOfTeams > 1)
      (1 to NumberOfTeams).foreach(i => insertSingleTeam(Team(s"Team $i", None, RoleService.roles), i))
    else
      insertSingleTeam(DefaultTeam)
  }

  def insertSingleTeam(team: Team, teamNumber: Int = 1) {
    Await.result(TeamDAO.findOneByName(team.name).futureBox.map {
      case Full(t) => t
      case _ =>
        TeamDAO.insert(team)
        val (users, admin) = insertUsers(team, teamNumber)
        val taskTypes = insertTaskTypesForTeam(team)
        addEk0563(users, team)
        addCortex(users, admin, team, taskTypes)
    }, 100 seconds)
  }

  def insertExplorativeAnnotation(nmlFile: File, user: User) = {
    NMLService.extractFromNML(nmlFile) match {
      case Full(nml) =>
        SkeletonTracingService.createFrom(List(nml), None, AnnotationSettings.skeletonDefault).toFox.flatMap {
          content =>
            AnnotationService.createFrom(
              user._id,
              user.teams.head.team, //TODO: refactor
              content,
              AnnotationType.Explorational,
              Some(nmlFile.getName))
        }
      case _ =>
        Logger.error(s"Invalid nml in file '${nmlFile.getAbsolutePath}'")
    }
  }

  def insertTaskAnnotation(task: Task, taskType: TaskType, nmlFile: File, user: User, annotationState: AnnotationState) = {
    NMLService.extractFromNML(nmlFile) match {
      case Full(nml) =>
        SkeletonTracingService.createFrom(List(nml), None, taskType.settings).toFox.flatMap {
          content =>
            val annotation = Annotation(
              Some(user._id),
              ContentReference.createFor(content),
              team = user.teams.head.team,
              _task = Some(task._id),
              _name = Some(nmlFile.getName),
              typ = AnnotationType.Task,
              state = annotationState)

            AnnotationDAO.insert(annotation).map { _ =>
              annotation
            }
            val current = System.currentTimeMillis
            val timeSpan = TimeSpan(
              1000,
              current,
              current,
              user._id,
              Some("autoadded"),
              annotation._name)
            TimeSpanDAO.insert(timeSpan)

        }
      case _ =>
        Logger.error(s"Invalid nml in file '${nmlFile.getAbsolutePath}'")
    }
  }

  def addEk0563(users: List[User], team: Team) {
    new File(s"public/nmls/ek0563/").listFiles.zipWithIndex.foreach{
      case (nmlFile, idx) =>
        insertExplorativeAnnotation(nmlFile, users(idx % 10))
    }
  }

  def addCortex(users: List[User], admin: AdminUser, team: Team, taskTypes: List[TaskType]) {
    val project = insertProject(team, admin, "cortex")
    val taskType = taskTypes.find(_.summary == "orthogonalShort").get
    for {
      typ <- List("finished", "unfinished")
      (file, idx) <- new File(s"public/nmls/cortex/$typ/").listFiles.zipWithIndex
    } yield {
      val coords = file.getName.split("_")
      val task = insertTask(
        admin,
        taskType,
        "cells_in_cortex",
        1,
        100,
        1,
        1,
        team,
        project,
        "2012-06-28_Cortex",
        Point3D.fromArray(coords.take(3).map(_.toInt)).get,
        BoundingBox(topLeft = Point3D(0,0,0), width = 0, height = 0, depth = 0))
      val annotationState = if(typ == "finished") AnnotationState.Finished else AnnotationState.InProgress
      insertTaskAnnotation(task, taskType, file, users(idx % 5 + 5), annotationState)
    }
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
        user
    }, 100 seconds)
  }

  /**
   * Insert predefined users into DB
   */
  def insertUsers(team: Team, teamNumber: Int): (List[User], AdminUser) = {
    var users = List.empty[User]

    val lastName = "WebKnossos"
    val mailDomain = "webknossos.org"
    val password = DefaultPasswords((teamNumber - 1) % NumberOfTeams)

    val adminUser =
      if(ShouldInsertSCMBoy) {
        insertSingleUser("SCM", "Boy", "scmboy@scalableminds.com", Role.Admin, DefaultTeam, "secret", Map.empty) // <- welche Experiences sollen hier hin?
      } else {
        val firstName = s"Admin $teamNumber"
        val mailAddress = s"admin$teamNumber"
        insertSingleUser(firstName, lastName, s"$mailAddress@$mailDomain", Role.Admin, team, password, Map.empty) // <- welche Experiences sollen hier hin?
      }

    for (j <- 1 to 5) {
      val firstNameUser = s"User $teamNumber$j"
      val mailAddressUser = s"user$teamNumber$j"
      users ::= insertSingleUser(firstNameUser, lastName, s"$mailAddressUser@$mailDomain", Role.User, team, password, Map("retina" -> 1))
    }

    for (j <- 6 to 10) {
      val firstNameUser = "User " + teamNumber.toString() + j.toString()
      val mailAddressUser = "user" + teamNumber.toString() + j.toString()
      users ::= insertSingleUser(firstNameUser, lastName, s"$mailAddressUser@$mailDomain", Role.User, team, password, Map("cells_in_cortex" -> 1))
    }

    (users, adminUser)
  }

  /**
   * Add a task
   */
  def insertTask(admin: AdminUser,
                 taskType: TaskType,
                 experienceDomain: String,
                 experienceLevel: Int,
                 priority: Int,
                 taskInstances: Int,
                 assignedInstances: Int,
                 team: Team,
                 project: Project,
                 dataSetName: String,
                 start: Point3D,
                 boundingBox: BoundingBox): Task = {
    // val task = Task(taskType._id, team.name, Experience(experienceDomain, experienceLevel), priority, taskInstances, 0, project, dataset,start,boundingBox)
    // I am not sure, what you tried to do here
    val task = Task(taskType._id, team.name, Experience(experienceDomain, experienceLevel), priority, taskInstances, assignedInstances, _project = Some(project.name))
    TaskDAO.insert(task)
    AnnotationService.createAnnotationBase(task, admin._id, boundingBox, taskType.settings, dataSetName, start)
    task
  }

  def insertTaskTypesForTeam(team: Team): List[TaskType] = {
    val noOtherModes = AnnotationSettings(allowedModes = List())
    val yesOtherModes = AnnotationSettings.default

    val taskTypes = List(
      TaskType(
        "orthogonalLong",
        "Please use only orthogonal mode",
        TraceLimit(5, 10, 20),
        team.name,
        noOtherModes),
      TaskType(
        "orthogonalShort",
        "Please use only orthogonal mode and don't take too long",
        TraceLimit(5, 10, 10),
        team.name,
        noOtherModes),
      TaskType(
        "allModesLong",
        "Use any mode",
        TraceLimit(5, 10, 20),
        team.name,
        yesOtherModes),
      TaskType(
        "allModesShort",
        "Use any mode and don't take too long",
        TraceLimit(5, 10, 10),
        team.name,
        yesOtherModes))
    taskTypes.foreach(TaskTypeDAO.insert)
    taskTypes
  }

  def insertProject(team: Team, owner: User, name: String): Project ={
    val project = Project(name, team.name, owner._id)
    ProjectDAO.insert(project)
    project
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
