import com.typesafe.scalalogging.LazyLogging
import play.api._
import play.api.mvc.Results.Ok
import play.api.mvc._
import utils.SQLClient


object Global extends GlobalSettings with LazyLogging{

  override def onStop(app: Application): Unit = {
    logger.info("Executing Global END")

    logger.info("Closing SQL Database handle")
    SQLClient.db.close()

    super.onStop(app)
  }

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.onRouteRequest(request)
    } else {
      Some(Action {Ok(views.html.main())})
    }
  }

}
