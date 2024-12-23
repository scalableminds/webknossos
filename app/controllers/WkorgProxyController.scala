package controllers

import com.google.inject.Inject
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mvc.CspHeaders
import com.scalableminds.util.tools.Fox
import models.user.{MultiUserDAO, Theme}
import opengraph.OpenGraphService
import play.api.libs.ws.WSClient
import play.api.mvc.{Action, AnyContent}
import play.filters.csp.CSPConfig
import security.WkEnv
import utils.WkConf

import scala.concurrent.ExecutionContext
import scala.util.matching.Regex

class WkorgProxyController @Inject()(ws: WSClient,
                                     conf: WkConf,
                                     sil: Silhouette[WkEnv],
                                     val cspConfig: CSPConfig,
                                     multiUserDAO: MultiUserDAO,
                                     openGraphService: OpenGraphService)(implicit ec: ExecutionContext)
    extends Controller
    with CspHeaders {

  def proxyPageOrMainView: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (matchesProxyPage(request)) {
      ws.url(conf.Proxy.prefix + request.uri).get().map(resp => Ok(resp.bodyAsBytes.utf8String).as(resp.contentType))
    } else {
      for {
        multiUserOpt <- Fox.runOptional(request.identity)(user =>
          multiUserDAO.findOne(user._multiUser)(GlobalAccessContext))
        openGraphTags <- openGraphService.getOpenGraphTags(
          request.path,
          request.getQueryString("sharingToken").orElse(request.getQueryString("token")))

      } yield
        addCspHeader(
          Ok(
            views.html.main(
              conf,
              multiUserOpt.map(_.selectedTheme).getOrElse(Theme.auto).toString,
              openGraphTags.title,
              openGraphTags.description,
              openGraphTags.image
            )
          )
        )
    }
  }

  private def matchesProxyPage(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isWkorgInstance && conf.Proxy.routes
      .exists(route => matchesPageWithWildcard(route, request.path)) && (request.identity.isEmpty || request.uri != "/")

  private def matchesPageWithWildcard(routeWithWildcard: String, actualRequest: String): Boolean = {
    val wildcardRegex = "^" + Regex.quote(routeWithWildcard).replace("*", "\\E.*\\Q") + "$"
    actualRequest.matches(wildcardRegex)
  }

}
