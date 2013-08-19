import models.basics.BasicEvolution
import oxalis.binary.BinaryDataService
import play.api._

object Global extends GlobalSettings {

  override def onStart(app: Application) {
    val conf = Play.current.configuration
    BinaryDataService.start(onComplete = {
      if (Play.current.mode == Mode.Dev) {
        BasicEvolution.runDBEvolution()
        // Data insertion needs to be delayed, because the dataSets need to be
        // found by the DirectoryWatcher first
        InitialData.insertTasks()
      }
      Logger.info("Directory start completed")
    })
  }

  override def onStop(app: Application) {
    BinaryDataService.stop()
    models.context.BinaryDB.connection.close()
    models.context.db.close()
  }
}