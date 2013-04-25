import akka.actor.Props
import play.api._
import play.api.Play.current
import play.api.libs.concurrent._
import play.api.Play.current
import models.security._
import models.task._
import models.user._
import models.Color
import models.task._
import models.binary._
import models.security.Role
import models.tracing._
import models.basics.BasicEvolution
import brainflight.mail.DefaultMails
import brainflight.tools.geometry._
import brainflight.tracing.TemporaryTracingGenerator
import brainflight.mail.Mailer
import brainflight.io._
import scala.collection.parallel.Tasks
import akka.pattern.ask
import akka.util.Timeout
import akka.actor.ActorSystem
import com.typesafe.config.ConfigFactory
import scala.collection.JavaConversions._
import brainflight.ActorSystems
import scala.concurrent.duration._
import play.api.libs.concurrent.Execution.Implicits._
import scala.util._

object Global extends GlobalSettings {

  lazy val DirectoryWatcher = Akka.system.actorOf(
    Props(new DirectoryWatcherActor(new DataSetChangeHandler)),
    name = "directoryWatcher")

  override def onStart(app: Application) {
    val conf = Play.current.configuration
    startActors()
    implicit val timeout = Timeout(( /*conf.getInt("actor.defaultTimeout") getOrElse*/ 25 seconds))
    if (conf.getBoolean("application.insertInitialData") getOrElse true) {
      InitialData.insertRoles
      InitialData.insertUsers
      InitialData.insertTaskAlgorithms
    }

    (DirectoryWatcher ? StartWatching("binaryData")).onComplete {
      case Success(x) =>
        if (Play.current.mode == Mode.Dev) {
          BasicEvolution.runDBEvolution()
          // Data insertion needs to be delayed, because the dataSets need to be
          // found by the DirectoryWatcher first
          InitialData.insertTasks
        }
        Logger.info("Directory start completed")
      case Failure(e) =>
        Logger.error(e.toString)
    }
    Role.ensureImportantRoles()
  }

  override def onStop(app: Application) {
    ActorSystems.dataRequestSystem.shutdown
    DirectoryWatcher ! StopWatching
    models.context.BinaryDB.connection.close()
    models.context.db.close()
  }

  def startActors() {
    Akka.system.actorOf(
      Props(new TemporaryTracingGenerator()),
      name = "temporaryTracingGenerator")
    Akka.system.actorOf(Props[Mailer], name = "mailActor")
  }
}

/**
 * Initial set of data to be imported
 * in the sample application.
 */
object InitialData {

  def insertRoles() = {
    if (Role.findAll.isEmpty) {
      Role.insertOne(Role("user", Nil, Color(0.2274F, 0.5294F, 0.6784F, 1)))
      Role.insertOne(Role("admin", Permission("admin.*", "*" :: Nil) :: Nil, Color(0.2F, 0.2F, 0.2F, 1)))
      Role.insertOne(Role("reviewer",
        Permission("admin.review.*", "*" :: Nil) ::
          Permission("admin.menu", "*" :: Nil) :: Nil,
        Color(0.2745F, 0.5333F, 0.2784F, 1)))
    }
  }
  def insertUsers() = {
    if (User.findOneByEmail("scmboy@scalableminds.com").isEmpty) {
      println("inserted")
      User.insertOne(User(
        "scmboy@scalableminds.com",
        "SCM",
        "Boy",
        true,
        brainflight.security.SCrypt.hashPassword("secret"),
        "local",
        UserConfiguration.defaultConfiguration,
        Set("user", "admin")))
    }
  }

  def insertTaskAlgorithms() = {
    if (TaskSelectionAlgorithm.findAll.isEmpty) {
      TaskSelectionAlgorithm.insertOne(TaskSelectionAlgorithm(
        """function simple(user, tasks){ 
          |  return tasks[0];
          |}""".stripMargin))
    }
  }

  def insertTasks() = {
    if (TaskType.findAll.isEmpty) {
      val user = User.findOneByEmail("scmboy@scalableminds.com").get
      val tt = TaskType(
        "ek_0563_BipolarCells",
        "Check those cells out!",
        TimeSpan(5, 10, 15))
      TaskType.insertOne(tt)
      if (Task.findAll.isEmpty) {
        val sample = Tracing.createTracingFor(User.default)

        var t = Task.insertOne(Task(
          0,
          tt._id,
          Experience("basic", 5)))
        Tracing.createTracingBase(t, user._id, DataSet.default.name, Point3D(50, 50, 50))

        t = Task.insertOne(Task(
          0,
          tt._id,
          Experience.empty,
          100,
          Integer.MAX_VALUE,
          training = Some(Training(
            "basic",
            5,
            5,
            sample._id))))
        Tracing.createTracingBase(t, user._id, DataSet.default.name, Point3D(0, 0, 0))
      }
    }
  }
}
