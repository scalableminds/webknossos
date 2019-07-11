import javax.inject.Inject
import play.api.OptionalDevContext
import play.api.http._
import play.api.mvc.Results._
import play.api.mvc.{Action, Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import play.core.{DefaultWebCommands, WebCommands}

class DsRequestHandler @Inject()(
                                 webCommands: WebCommands,
                                 optionalDevContext: OptionalDevContext,
                                 router: Router,
                                 errorHandler: HttpErrorHandler,
                                 configuration: HttpConfiguration,
                                 filters: HttpFilters)
    extends DefaultHttpRequestHandler(webCommands, optionalDevContext, router, errorHandler, configuration, filters)
    with InjectedController {
  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.method == "OPTIONS") {
      Some(Action {
        Ok(":D").withHeaders(
          "Access-Control-Allow-Origin" -> "*",
          "Access-Control-Max-Age" -> "600",
          "Access-Control-Allow-Methods" -> "POST, GET, DELETE, PUT, HEAD, PATCH, OPTIONS",
          "Access-Control-Allow-Headers" -> request.headers.get("Access-Control-Request-Headers").getOrElse(""),
          "Access-Control-Expose-Headers" -> "MISSING-BUCKETS"
        )
      })
    } else {
      super.routeRequest(request)
    }
}
