import javax.inject.Inject
import play.api.http.{DefaultHttpRequestHandler, HttpConfiguration, HttpErrorHandler, HttpFilters}
import play.api.mvc.Results.Ok
import play.api.mvc.{Action, Handler, InjectedController, RequestHeader}
import play.api.routing.Router
import utils.WkConf

class RequestHandler @Inject()(router: Router,
                               errorHandler: HttpErrorHandler,
                               httpConfiguration: HttpConfiguration,
                               filters: HttpFilters,
                               conf: WkConf)
    extends DefaultHttpRequestHandler(router, errorHandler, httpConfiguration, filters)
    with InjectedController {

  override def routeRequest(request: RequestHeader): Option[Handler] =
    if (request.uri.matches("^(/api/|/data/|/tracings/|/assets/).*$")) {
      super.routeRequest(request)
    } else {
      Some(Action { Ok(views.html.main(conf)) })
    }

}
