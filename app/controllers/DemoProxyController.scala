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
import scala.util.matching.Regex

class DemoProxyController @Inject()(ws: WSClient, conf: WkConf, sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  def proxyPageOrMainView: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (matchesProxyPage(request)) {
      ws.url(conf.Proxy.prefix + request.uri).get().map(resp => Ok(resp.bodyAsBytes.utf8String).as("text/html"))
    } else Fox.successful(Ok(views.html.main(conf)))
  }

  private def matchesProxyPage(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isDemoInstance && conf.Proxy.routes
      .exists(route => matchesPageWithWildcard(route, request.uri)) && (request.identity.isEmpty || request.uri != "/")

  private def matchesPageWithWildcard(routeWithWildcard: String, actualRequest: String): Boolean = {
    val wildcardRegex = "^" + Regex.quote(routeWithWildcard).replace("*", "\\E.*\\Q") + "$"
    actualRequest.matches(wildcardRegex)
  }

}
