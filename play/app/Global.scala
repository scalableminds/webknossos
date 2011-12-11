import brainflight.binary.{FrustumModel, CubeModel, ModelStore}
import play.api._

import models._

object Global extends GlobalSettings {
  
  override def onStart(app: Application) {
    ModelStore.register(CubeModel, FrustumModel)
    InitialData.insert()
  }
  
}

/**
 * Initial set of data to be imported 
 * in the sample application.
 */
object InitialData {
  
  def date(str: String) = new java.text.SimpleDateFormat("yyyy-MM-dd").parse(str)
  
  def insert() = {
    
    if(User.findAll.isEmpty) {
      val u = User("scmboy@scalableminds.com", "SCM Boy", "secret", true)
      Seq(
        u
      ).foreach(User.create)
      val p = Project("Personal", "Private")
      Seq(
        Project("Play framework", "Play 2.0") -> Seq("scmboy@scalableminds.com", "scmboy@scalableminds.com", "scmboy@scalableminds.com", "scmboy@scalableminds.com"),
        Project("Play framework", "Play 1.2.4") -> Seq("scmboy@scalableminds.com", "scmboy@scalableminds.com"),
        Project("Play framework", "Website") -> Seq("scmboy@scalableminds.com", "scmboy@scalableminds.com"),
        Project("Zenexity", "Secret project") -> Seq("scmboy@scalableminds.com", "scmboy@scalableminds.com", "scmboy@scalableminds.com", "scmboy@scalableminds.com"),
        Project("Zenexity", "Playmate") -> Seq("scmboy@scalableminds.com"),
        Project("Personal", "Things to do") -> Seq("scmboy@scalableminds.com"),
        Project("Zenexity", "Play samples") -> Seq("scmboy@scalableminds.com", "scmboy@scalableminds.com"),
        Project("Personal", "Private") -> Seq("scmboy@scalableminds.com"),
        Project("Personal", "Private") -> Seq("scmboy@scalableminds.com"),
        Project("Personal", "Private") -> Seq("scmboy@scalableminds.com"),
        p -> Seq("scmboy@scalableminds.com")
      ).foreach {
        case (project,members) => Project.create(project, members)
      }
      
      Seq(
        Task("", p._id, "Fix the documentation", false, None, Some(u._id)),
        Task("", p._id, "Prepare the beta release", false, Some(date("2011-11-15")), None),
        Task("", p._id, "Buy some milk", false, None, None),
        Task("", p._id, "Check 1.2.4-RC2", false, Some(date("2011-11-18")), Some(u._id)),
        Task("", p._id, "Finish zentask integration", true, Some(date("2011-11-15")), Some(u._id)),
        Task("", p._id, "Release the secret project", false, Some(date("2012-01-01")), Some(u._id))
      ).foreach(Task.create)
      
    }
    
  }
  
}