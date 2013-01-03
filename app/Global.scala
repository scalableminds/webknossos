import akka.actor.Props
import play.api._
import play.api.Play.current
import play.api.libs.concurrent._
import play.api.Play.current
import models.security._
import models.task._
import models.user._
import models.Color
import models.graph._
import models.task._
import models.binary._
import models.tracing._
import models.basics.BasicEvolution
import brainflight.mail.DefaultMails
import brainflight.tools.geometry._
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

object Global extends GlobalSettings {

  lazy val DirectoryWatcher = Akka.system.actorOf(
    Props(new DirectoryWatcherActor(new DataSetChangeHandler)),
    name = "directoryWatcher")

  override def onStart(app: Application) {
      implicit val timeout = Timeout(5 seconds)
      (DirectoryWatcher ? StartWatching("binaryData")).onSuccess {
        case x =>
          if (Play.current.mode == Mode.Dev) {
            BasicEvolution.runDBEvolution()
            // Data insertion needs to be delayed, because the dataSets need to be
            // found by the DirectoryWatcher first
            InitialData.insert()
          }
      }
  }

  override def onStop(app: Application) {
    ActorSystems.dataRequestSystem.shutdown
    DirectoryWatcher ! StopWatching
    models.context.BinaryDB.connection.close()
    models.context.db.close()
  }
}

/**
 * Initial set of data to be imported
 * in the sample application.
 */
object InitialData {

  def insert() = {
    if (Role.findAll.isEmpty) {
      Role.insertOne(Role("user", Nil, Color(0.2274F, 0.5294F, 0.6784F, 1)))
      Role.insertOne(Role("admin", Permission("admin.*", "*" :: Nil) :: Nil, Color(0.2F, 0.2F, 0.2F, 1)))
      Role.insertOne(Role("reviewer",
        Permission("admin.review.*", "*" :: Nil) ::
          Permission("admin.menu", "*" :: Nil) :: Nil,
        Color(0.2745F, 0.5333F, 0.2784F, 1)))
    }

    if (User.findOneByEmail("scmboy@scalableminds.com").isEmpty) {
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

    if (TaskSelectionAlgorithm.findAll.isEmpty) {
      TaskSelectionAlgorithm.insertOne(TaskSelectionAlgorithm(
        """function simple(user, tasks){ 
          |  return tasks[0];
          |}""".stripMargin))
    }

    if (TaskType.findAll.isEmpty) {
      val tt = TaskType(
        "ek_0563_BipolarCells",
        "Check those cells out!",
        TimeSpan(5, 10, 15))
      TaskType.insertOne(tt)
      if (Task.findAll.isEmpty) {
        val sample = Tracing.createTracingFor(User.default)

        Task.insertOne(Task(
          DataSet.default.name,
          0,
          tt._id,
          Point3D(0, 0, 0),
          Experience("basic", 5)))

        Task.insertOne(Task(
          DataSet.default.name,
          0,
          tt._id,
          Point3D(50, 50, 50),
          Experience.empty,
          100,
          Integer.MAX_VALUE,
          training = Some(Training(
            "basic",
            5,
            5,
            sample._id))))
      }
    }
  }
}
