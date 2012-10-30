import brainflight.tools.geometry._
import play.api._
import play.api.Play.current
import models._
import brainflight.mail.DefaultMails
import models.graph.Experiment
import models.graph.Tree
import models.graph.Node
import play.api.libs.concurrent._
import play.api.Play.current
import akka.actor.Props
import brainflight.mail.Mailer
import brainflight.io.StartWatching
import brainflight.io.DataSetChangeHandler
import brainflight.io.DirectoryWatcherActor
import models.basics.BasicEvolution
import scala.collection.parallel.Tasks

object Global extends GlobalSettings {

  override def onStart(app: Application) {
    val DirectoryWatcher = Akka.system.actorOf(
      Props(new DirectoryWatcherActor(new DataSetChangeHandler)),
      name = "directoryWatcher")
    DirectoryWatcher ! StartWatching("binaryData")

    if (Play.current.mode == Mode.Dev) {
      BasicEvolution.runDBEvolution()
      InitialData.insert()
    }
  }
}

/**
 * Initial set of data to be imported
 * in the sample application.
 */
object InitialData {

  def insert() = {
    if (Role.findAll.isEmpty) {
      Role.insert(Role("user", Nil))
      Role.insert(Role("admin", Permission("*", "*" :: Nil) :: Nil))
    }

    if (User.findAll.isEmpty) {
      val u = ("scmboy@scalableminds.com", "SCM Boy", "secret")
      Seq(
        u).foreach{ values =>
        val user = (User.create _ tupled)(values)
        User.verify(user)
      }
    }
    
    if (TaskSelectionAlgorithm.findAll.isEmpty) {
      TaskSelectionAlgorithm.insert(TaskSelectionAlgorithm(
        """function simple(user, tasks){ 
          |  return tasks[0];
          |}""".stripMargin))
    }
  }
}
