import com.typesafe.scalalogging.LazyLogging
import controllers.{Assets, DemoProxyController, SitemapController}
import javax.inject.Inject
import play.api.OptionalDevContext
import play.api.http.{DefaultHttpRequestHandler, HttpConfiguration, HttpErrorHandler, HttpFilters}
import play.api.mvc.{Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import play.core.WebCommands
import utils.WkConf

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
    with LazyLogging {

  override def routeRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/tracings/).*$")) {
      super.routeRequest(request)
    } else if (request.uri.matches("^(/assets/).*$")) {
      val path = request.path.replaceFirst("^(/assets/)", "")
      Some(assets.at(path = "/public", file = path))
    } else if (request.uri.matches("""^/sitemap.xml$""") && conf.Features.isDemoInstance) {
      Some(sitemapController.getSitemap(Some(conf.Http.uri)))
    } else if (request.uri == "/favicon.ico") {
      Some(Action { NotFound })
    } else Some(demoProxyController.proxyPageOrMainView)
  }
}
