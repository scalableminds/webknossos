import com.newrelic.api.agent.NewRelic
import com.typesafe.scalalogging.LazyLogging
import play.api._
import play.api.mvc._
import utils.SQLClient

object Global extends GlobalSettings with LazyLogging{

  override def onStop(app: Application): Unit = {
    logger.info("Executing Global END")

    logger.info("Closing SQL Database handle")
    SQLClient.db.close()

    super.onStop(app)
  }

  override def onError(request: RequestHeader, ex: Throwable) = {
    NewRelic.noticeError(ex)
    super.onError(request, ex)
  }
}
