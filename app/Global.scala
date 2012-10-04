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

object Global extends GlobalSettings {
  
  override def onStart(app: Application) {
    val DirectoryWatcher = Akka.system.actorOf( Props[DirectoryWatcherActor], name = "directoryWatcher" )
    DirectoryWatcher ! StartWatching("binaryData", new DataSetChangeHandler)
    
    if (Play.current.mode == Mode.Dev)
      InitialData.insert() 
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
      val u = ("scmboy@scalableminds.com", "SCM Boy", "secret", List(Experiment.createNew._id))
      Seq(
        u).foreach(User.create _ tupled)
    }
  }
}
