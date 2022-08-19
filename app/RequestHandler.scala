import com.typesafe.scalalogging.LazyLogging
import controllers.{Assets, DemoProxyController, SitemapController}
import play.api.OptionalDevContext
import play.api.http.{DefaultHttpRequestHandler, HttpConfiguration, HttpErrorHandler, HttpFilters}
import play.api.mvc.Results.Ok
import play.api.mvc.{Handler, InjectedController, RequestHeader, Result}
import play.api.routing.Router
import play.core.WebCommands
import utils.WkConf

import javax.inject.Inject

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
class RequestHandler @Inject()(webCommands: WebCommands,
                               optionalDevContext: OptionalDevContext,
                               router: Router,
                               errorHandler: HttpErrorHandler,
                               httpConfiguration: HttpConfiguration,
                               demoProxyController: DemoProxyController,
                               filters: HttpFilters,
                               conf: WkConf,
                               assets: Assets,
                               sitemapController: SitemapController)
    extends DefaultHttpRequestHandler(
      webCommands,
      optionalDevContext,
      router,
      errorHandler,
      httpConfiguration,
      filters
    )
    with InjectedController
    with LazyLogging
    with AdditionalHeaders {

  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.method == "OPTIONS") {
      Some(Action {
        options(request)
      })
    } else if (request.uri.matches("^(/api/|/data/|/tracings/|/swagger).*$")) {
      super.routeRequest(request)
    } else if (request.uri.matches("^(/assets/).*$")) {
      val path = request.path.replaceFirst("^(/assets/)", "")
      Some(assets.at(path = "/public", file = path))
    } else if (request.uri.matches("""^/sitemap.xml$""") && conf.Features.isDemoInstance) {
      Some(sitemapController.getSitemap(conf.Http.uri))
    } else if (request.uri.matches("^/sw\\.(.*)\\.js$") && conf.Features.isDemoInstance) {
      Some(Action { Ok("").as("text/javascript") })
    } else if (request.uri == "/favicon.ico") {
      Some(Action { NotFound })
    } else Some(demoProxyController.proxyPageOrMainView)
}
