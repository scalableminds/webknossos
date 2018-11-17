import java.nio.file.Paths

import controllers.{Assets, AssetsFinder}
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
                               af: AssetsFinder,
                               env: Environment)
    extends DefaultHttpRequestHandler(
      router,
      errorHandler,
      httpConfiguration,
      filters
    )
    with InjectedController {

  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.uri.matches("^(/api/|/data/|/tracings/).*$")) {
      super.routeRequest(request)
    } else {
      val file =
        Paths.get(env.rootPath + af.assetsBasePath + request.path).toFile
      if (request.path.matches("^.+\\..+$") || (file.exists && file.isFile))
        Some(assets.at(path = "/public", file = request.path))
      else
        Some(Action { Ok(views.html.main(conf)) })
    }
}
