package controllers

import com.google.inject.Inject
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.tools.Fox
import oxalis.security.WkEnv
import play.api.libs.ws.WSClient
import play.api.mvc.{Action, AnyContent}
import utils.WkConf

import scala.concurrent.ExecutionContext

class DemoProxyController @Inject()(ws: WSClient, conf: WkConf, sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  def matchesProxyPage(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isDemoInstance && conf.Proxy.routes
      .contains(request.uri) && (request.identity.isEmpty || request.uri != "/")

  def proxyPageOrMainView: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (matchesProxyPage(request)) {
      ws.url(conf.Proxy.prefix + request.uri).get().map(resp => Ok(resp.body).as("text/html"))
    } else Fox.successful(Ok(views.html.main(conf)))
  }

}
