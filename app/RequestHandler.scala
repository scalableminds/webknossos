import com.scalableminds.util.mvc.{CspHeaders, ExtendedController}
import com.typesafe.scalalogging.LazyLogging
import controllers.{Assets, SitemapController, WkorgProxyController}

import javax.inject.Inject
import play.api.OptionalDevContext
import play.api.http.{DefaultHttpRequestHandler, HttpConfiguration, HttpErrorHandler, HttpFilters}
import play.api.mvc.{Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import play.core.WebCommands
import play.filters.csp.CSPConfig
import utils.WkConf

import scala.concurrent.ExecutionContext

class RequestHandler @Inject()(webCommands: WebCommands,
                               optionalDevContext: OptionalDevContext,
                               router: Router,
                               errorHandler: HttpErrorHandler,
                               httpConfiguration: HttpConfiguration,
                               wkorgProxyController: WkorgProxyController,
                               filters: HttpFilters,
                               val cspConfig: CSPConfig,
                               conf: WkConf,
                               assets: Assets,
                               sitemapController: SitemapController)(implicit ec: ExecutionContext)
    extends DefaultHttpRequestHandler(
      webCommands,
      optionalDevContext,
      () => router,
      errorHandler,
      httpConfiguration,
      filters
    )
    with InjectedController
    with ExtendedController
    with CspHeaders
    with LazyLogging {

  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (apiVersionIsTooNew(request)) {
      Some(Action {
        JsonNotFound(
          f"This WEBKNOSSOS instance does not yet support this API version. The requested API version is higher than the current API version $CURRENT_API_VERSION.")
      })
    } else if (request.uri.matches("^(/api/|/data/|/tracings/|/\\.well-known/).*$")) {
      super.routeRequest(request)
    } else if (request.uri.matches("^(/assets/).*(worker.js).*$")) {
      Some(assetWithCsp(request))
    } else if (request.uri.matches("^(/assets/).*$")) {
      Some(asset(request))
    } else if (request.uri.matches("""^/sitemap.xml$""") && conf.Features.isWkorgInstance) {
      Some(sitemapController.getSitemap(conf.Http.uri))
    } else if (request.uri.matches("^/sw\\.(.*)\\.js$") && conf.Features.isWkorgInstance) {
      Some(Action { Ok("").as("text/javascript") })
    } else if (request.uri == "/favicon.ico") {
      Some(Action { NotFound })
    } else Some(wkorgProxyController.proxyPageOrMainView)

  private def assetWithCsp(requestHeader: RequestHeader) = Action.async { implicit request =>
    addCspHeader(asset(requestHeader))
  }

  private def asset(requestHeader: RequestHeader) = {
    val path = requestHeader.path.replaceFirst("^(/assets/)", "")
    assets.at(path = "/public", file = path)
  }

  private def CURRENT_API_VERSION = 6

  private def apiVersionIsTooNew(request: RequestHeader): Boolean =
    "^/api/v(\\d+).*$".r.findFirstMatchIn(request.uri) match {
      case Some(m) =>
        val version = m.group(1)
        version.toInt > CURRENT_API_VERSION
      case None => false
    }

}
