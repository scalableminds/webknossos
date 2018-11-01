import java.nio.file.{Files, Paths}

import javax.inject.Inject
import play.api.http.{DefaultHttpRequestHandler, HttpConfiguration, HttpErrorHandler, HttpFilters}
import play.api.mvc.Results.Ok
import play.api.mvc.{Action, Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import play.api.Play._
import utils.WkConf

class RequestHandler @Inject() (router: Router,
                                errorHandler: HttpErrorHandler,
                                httpConfiguration: HttpConfiguration,
                                filters: HttpFilters,
                                conf: WkConf)
  extends DefaultHttpRequestHandler(router, errorHandler, httpConfiguration, filters) with InjectedController {

  override def routeRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/tracings/).*$")) {
      super.routeRequest(request)
    } else {
      if(Files.exists(Paths.get("/public", request.path)))
        Some(controllers.Assets.at(path="/public", file=request.path))
      else
        Some(controllers.Assets.at(path="/public", file="bundle/index.html"))
    }
  }

}
