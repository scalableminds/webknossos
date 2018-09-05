import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api._
import play.api.mvc.Results.Ok
import play.api.mvc._

object Global extends GlobalSettings with LazyLogging {

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.onRouteRequest(request)
    } else {
      Some(Action {Ok(views.html.main())})
    }
  }

}
