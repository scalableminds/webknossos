import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import play.api.OptionalDevContext
import play.api.http._
import play.api.mvc.Results._
import play.api.mvc.{Action, AnyContent, Handler, InjectedController, RequestHeader, Result}
import play.api.routing.Router
import play.core.{DefaultWebCommands, WebCommands}

trait AdditionalHeaders {
  def options(request: RequestHeader): Result =
    Ok(":D").withHeaders(
      "Access-Control-Allow-Origin" -> "*",
      "Access-Control-Max-Age" -> "600",
      "Access-Control-Allow-Methods" -> "POST, GET, DELETE, PUT, HEAD, PATCH, OPTIONS",
      "Access-Control-Allow-Headers" -> request.headers.get("Access-Control-Request-Headers").getOrElse(""),
      "Access-Control-Expose-Headers" -> "MISSING-BUCKETS"
    )
}

class DsRequestHandler @Inject()(webCommands: WebCommands,
                                 optionalDevContext: OptionalDevContext,
                                 router: Router,
                                 errorHandler: HttpErrorHandler,
                                 configuration: HttpConfiguration,
                                 filters: HttpFilters,
                                 conf: DataStoreConfig)
    extends DefaultHttpRequestHandler(webCommands, optionalDevContext, router, errorHandler, configuration, filters)
    with InjectedController
    with AdditionalHeaders
    with LazyLogging {
  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.method == "OPTIONS") {
      Some(Action { options(request) })
    } else {
      if (request.path == "/" || request.path == "/index.html") {
        Some(Action {
          Ok(
            views.html
              .datastoreFrontpage("Datastore", conf.Datastore.name, conf.Datastore.WebKnossos.uri, "/data/health"))
        })
      } else {
        super.routeRequest(request)
      }
    }
}
