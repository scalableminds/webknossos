import javax.inject.Inject
import play.api.http._
import play.api.mvc.Results._
import play.api.mvc.{Action, RequestHeader}
import play.api.routing.Router

class HttpRequestHandler @Inject() (router: Router, errorHandler: HttpErrorHandler,
                                    configuration: HttpConfiguration, filters: HttpFilters)
  extends DefaultHttpRequestHandler(router, errorHandler, configuration, filters) {
  override def routeRequest(request: RequestHeader) = {
    if (request.method == "OPTIONS") {
      Some(Action {
        Ok(":D").withHeaders(
          "Access-Control-Allow-Origin" -> "*",
          "Access-Control-Max-Age" -> "600",
          "Access-Control-Allow-Methods" -> "POST, GET, DELETE, PUT, HEAD, PATCH, OPTIONS",
          "Access-Control-Allow-Headers" -> request.headers.get("Access-Control-Request-Headers").getOrElse(""))
      })
    } else {
      super.routeRequest(request)
    }
  }
}
