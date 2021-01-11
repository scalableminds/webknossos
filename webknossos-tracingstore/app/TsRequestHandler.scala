import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.typesafe.scalalogging.LazyLogging
import play.api.OptionalDevContext
import play.api.http._
import play.api.mvc.{Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import play.core.WebCommands

import javax.inject.Inject

class TsRequestHandler @Inject()(webCommands: WebCommands,
                                 optionalDevContext: OptionalDevContext,
                                 router: Router,
                                 errorHandler: HttpErrorHandler,
                                 configuration: HttpConfiguration,
                                 filters: HttpFilters,
                                 conf: TracingStoreConfig)
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
            views.html.datastoreFrontpage("Tracingstore",
                                          conf.Tracingstore.name,
                                          conf.Tracingstore.WebKnossos.uri,
                                          "/tracings/health"))
        })
      } else {
        super.routeRequest(request)
      }
    }
}
