import play.api._
import play.api.libs.concurrent._
import braingames.stackrenderer._

object Global extends GlobalSettings {
    
  
  override def onStart(app: Application) {

      implicit val sys = Akka.system(app)
      StackRenderingSupervisor.start ! StartRendering()
      
      BinaryDataService.start()
  }

  override def onStop(app: Application) {

  }
}