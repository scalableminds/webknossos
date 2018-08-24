import javax.inject.Inject
import play.api.http._
import play.api.mvc.Results._
import play.api.mvc.{Action, RequestHeader}
import play.api.routing.Router

class RequestHandler @Inject() (router: Router, errorHandler: HttpErrorHandler,
                                configuration: HttpConfiguration, filters: HttpFilters)
  extends DefaultHttpRequestHandler(router, errorHandler, configuration, filters) {
  override def routeRequest(request: RequestHeader) = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.routeRequest(request)
    } else {
      Some(Action {Ok(views.html.main())})
    }
  }
}
