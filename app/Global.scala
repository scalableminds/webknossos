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
    if (Play.current.mode == Mode.Dev)
      InitialData.insert()
      
      val dwa = Akka.system.actorOf( Props[DirectoryWatcherActor], name = "directoryWatcher" )
      dwa ! StartWatching("binaryData", new DataSetChangeHandler)
  }

}

/**
 * Initial set of data to be imported
 * in the sample application.
 */
object InitialData {

  def insert() = {
    /*if ( DataSet.findAll.isEmpty ) {
      DataSet.insert( DataSet(
        "2012-06-28_Cortex",
        Play.configuration.getString( "binarydata.path" ) getOrElse ( "binaryData/" )+"2012-06-28_Cortex",
        List( 0, 1, 2, 3 ),
        Point3D(24 * 128, 16 * 128, 8 * 128) ) )
    }*/

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
