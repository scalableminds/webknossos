import com.scalableminds.util.mvc.{ApiVersioning, ExtendedController}
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
    extends DefaultHttpRequestHandler(webCommands,
                                      optionalDevContext,
                                      () => router,
                                      errorHandler,
                                      configuration,
                                      filters)
    with InjectedController
    with ExtendedController
    with AdditionalHeaders
    with LazyLogging
    with ApiVersioning {
  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.method == "OPTIONS") {
      Some(Action { options(request) })
    } else if (request.path == "/" || request.path == "/index.html") {
      Some(Action {
        Ok(
          views.html.datastoreFrontpage("Tracingstore",
                                        conf.Tracingstore.name,
                                        conf.Tracingstore.WebKnossos.uri,
                                        "/tracings/health"))
      })
    } else if (isInvalidApiVersion(request)) {
      Some(Action {
        JsonNotFound(invalidApiVersionMessage(request))
      })
    } else {
      super.routeRequest(request)
    }
}
