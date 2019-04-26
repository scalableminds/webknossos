import com.typesafe.scalalogging.LazyLogging
import controllers.{Assets, SitemapController}
import javax.inject.Inject
import play.api.Environment
import play.api.http.{DefaultHttpRequestHandler, HttpConfiguration, HttpErrorHandler, HttpFilters}
import play.api.mvc.{Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import utils.WkConf

class RequestHandler @Inject()(router: Router,
                               errorHandler: HttpErrorHandler,
                               httpConfiguration: HttpConfiguration,
                               filters: HttpFilters,
                               conf: WkConf,
                               assets: Assets,
                               env: Environment,
                               sitemapController: SitemapController)
    extends DefaultHttpRequestHandler(
      router,
      errorHandler,
      httpConfiguration,
      filters
    )
    with InjectedController
    with LazyLogging {

  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.uri.matches("^(/api/|/data/|/tracings/).*$")) {
      super.routeRequest(request)
    } else if (request.uri.matches("^(/assets/).*$")) {
      val path = request.path.replaceFirst("^(/assets/)", "")
      Some(assets.at(path = "/public", file = path))
    } else if (request.uri.matches("""^/sitemap.xml$""") && conf.Features.isDemoInstance) {
      Some(sitemapController.getSitemap(Some(conf.Http.uri)))
    } else {
      Some(Action { Ok(views.html.main(conf)) })
    }
}
