import brainflight.binary.{FrustumModel, CubeModel, ModelStore}
import brainflight.tools.geometry._
import models.PosDir
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

  def insert() = {
    if (OriginPosDir.findAll.isEmpty)
      OriginPosDir.insert(OriginPosDir(PosDir(Vector3D(1.0,1.0,1.0), Vector3D(1.0,1.0,1.0)), 0))
    
    if (User.findAll.isEmpty) {

      val u = User("scmboy@scalableminds.com", "SCM Boy", "secret", true)
      Seq(
        u
      ).foreach(User.create)
    }

  }

}