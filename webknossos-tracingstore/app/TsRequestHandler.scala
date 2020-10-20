import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import play.api.OptionalDevContext
import play.api.http._
import play.api.mvc.{Action, Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import play.core.WebCommands


class TsRequestHandler @Inject()(webCommands: WebCommands,
                                 optionalDevContext: OptionalDevContext,
                                 router: Router,
                                 errorHandler: HttpErrorHandler,
                                 configuration: HttpConfiguration,
                                 filters: HttpFilters,
                                 conf: TracingStoreConfig)
  extends DefaultHttpRequestHandler(webCommands, optionalDevContext, router, errorHandler, configuration, filters)
    with InjectedController with AdditionalHeaders with LazyLogging {
  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.method == "OPTIONS") {
      Some(Action { options(request) })
    } else {
      if (request.path == "/" || request.path == "/index.html") {
        Some(Action { Ok(s"Hello from the webKnossos Tracingstore “${conf.Tracingstore.name}” at ${conf.Http.uri} serving the webKnossos instance at ${conf.Tracingstore.WebKnossos.uri}. All systems operational.") })
      } else {
        super.routeRequest(request)
      }
    }
}
