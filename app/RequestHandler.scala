import controllers.{AboutPageRedirectController, Application, SitemapController}
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import play.api.OptionalDevContext
import play.api.http.{DefaultHttpRequestHandler, HttpConfiguration, HttpErrorHandler, HttpFilters}
import play.api.mvc.{Handler, RequestHeader}
import play.api.routing.Router
import play.core.WebCommands
import utils.{ApiVersioning, WkConf}

import scala.concurrent.ExecutionContext

class RequestHandler @Inject() (
    webCommands: WebCommands,
    optionalDevContext: OptionalDevContext,
    router: Router,
    errorHandler: HttpErrorHandler,
    httpConfiguration: HttpConfiguration,
    aboutPageRedirectController: AboutPageRedirectController,
    filters: HttpFilters,
    conf: WkConf,
    sitemapController: SitemapController,
    application: Application
)(implicit ec: ExecutionContext)
    extends DefaultHttpRequestHandler(
      webCommands,
      optionalDevContext,
      () => router,
      errorHandler,
      httpConfiguration,
      filters
    )
    with ApiVersioning
    with LazyLogging {

  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (isInvalidApiVersion(request)) {
      Some(application.invalidApiVersion)
    } else if (request.uri.matches("^(/api/|/data/|/tracings/|/\\.well-known/).*$")) {
      super.routeRequest(request)
    } else if (request.uri.matches("^(/assets/).*(worker.js).*$")) {
      Some(application.assetWithCsp(request))
    } else if (request.uri.matches("^(/assets/).*$")) {
      Some(application.asset(request))
    } else if (request.uri.matches("""^/sitemap.xml$""") && conf.Features.isWkorgInstance) {
      Some(sitemapController.getSitemap(conf.Http.uri))
    } else if (request.uri.matches("^/sw\\.(.*)\\.js$") && conf.Features.isWkorgInstance) {
      Some(application.emptyStringOk)
    } else if (request.uri == "/favicon.ico") {
      Some(application.notFound)
    } else Some(aboutPageRedirectController.redirectToAboutPageOrSendMainView)

}
