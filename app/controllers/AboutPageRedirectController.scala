package controllers

import com.google.inject.Inject
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mvc.CspHeaders
import com.scalableminds.util.tools.Fox
import models.user.MultiUserDAO
import opengraph.OpenGraphService
import play.api.mvc.{Action, AnyContent}
import play.filters.csp.CSPConfig
import security.WkEnv
import utils.WkConf

import scala.concurrent.ExecutionContext
import scala.util.matching.Regex

class AboutPageRedirectController @Inject()(conf: WkConf,
                                            sil: Silhouette[WkEnv],
                                            val cspConfig: CSPConfig,
                                            multiUserDAO: MultiUserDAO,
                                            openGraphService: OpenGraphService,
                                            assets: controllers.Assets)(implicit ec: ExecutionContext)
    extends Controller
    with CspHeaders {

  def redirectToAboutPageOrSendMainView: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (matchesRedirectRoute(request)) {
      val status = if (request.uri == "/") SEE_OTHER else MOVED_PERMANENTLY
      Fox.successful(Redirect(conf.AboutPageRedirect.prefix + request.uri, status = status))
    } else {
      for {
        multiUserOpt <- Fox.runOptional(request.identity)(user =>
          multiUserDAO.findOne(user._multiUser)(GlobalAccessContext))
        openGraphTags <- openGraphService.getOpenGraphTags(
          request.path,
          request.getQueryString("sharingToken").orElse(request.getQueryString("token")))
        result <- Fox.fromFuture(assets.at("/public", "index.html").apply(request).map(addCspHeader))
      } yield result
    }
  }

  private def matchesRedirectRoute(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isWkorgInstance && conf.AboutPageRedirect.routes.exists(route =>
      matchesRouteWithWildcard(route, request.path)) && (request.identity.isEmpty || request.uri != "/")

  private def matchesRouteWithWildcard(routeWithWildcard: String, actualRequest: String): Boolean = {
    val wildcardRegex = "^" + Regex.quote(routeWithWildcard).replace("*", "\\E.*\\Q") + "$"
    actualRequest.matches(wildcardRegex)
  }

}
