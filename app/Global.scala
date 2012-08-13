import brainflight.tools.geometry._
import play.api._
import play.api.Play.current
import models._
import brainflight.mail.DefaultMails
import models.graph.Experiment
import models.graph.Tree
import models.graph.Node

object Global extends GlobalSettings {

  override def onStart(app: Application) {
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
    if (DataSet.findAll.isEmpty) {
      DataSet.insert(DataSet(
        "2012-06-28_Cortex",
        Play.configuration.getString("binarydata.path") getOrElse ("binaryData/") + "2012-06-28_Cortex",
        List(0, 1, 2, 3),
        Point3D(24 * 128, 16 * 128, 8 * 128)))

    }

    if (Role.findAll.isEmpty) {
      Role.insert(Role("user", Nil))
      Role.insert(Role("admin", Permission("*", "*" :: Nil) :: Nil))
    }

    if (Experiment.findAll.isEmpty) {
      val d = DataSet.default
      val p = Point3D(300, 300, 200)
      val nodes = List(Node(1, 1, p, 0, 0, 0))
      val tree = Tree(1, nodes, Nil, Color(1, 0, 0, 0))
      val exp = Experiment(d._id, List(tree), Nil, 0, 1, p)
      Experiment.insert(exp)
    }

    if (User.findAll.isEmpty) {
      val u = ("scmboy@scalableminds.com", "SCM Boy", "secret", List(Experiment.default._id))
      Seq(
        u).foreach(User.create _ tupled)
    }
  }

}