package controllers

import com.google.inject.Inject
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mvc.CspHeaders
import com.scalableminds.util.tools.Fox
import models.user.{MultiUserDAO, Theme}
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
                                            openGraphService: OpenGraphService)(implicit ec: ExecutionContext)
    extends Controller
    with CspHeaders {

  def redirectToAboutPageOrSendMainView: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (matchesRedirectRoute(request)) {
      Fox.successful(Redirect(conf.AboutPageRedirect.prefix + request.uri))
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

  private def matchesRedirectRoute(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isWkorgInstance && conf.AboutPageRedirect.routes.exists(route =>
      matchesRouteWithWildcard(route, request.path)) && (request.identity.isEmpty || request.uri != "/")

  private def matchesRouteWithWildcard(routeWithWildcard: String, actualRequest: String): Boolean = {
    val wildcardRegex = "^" + Regex.quote(routeWithWildcard).replace("*", "\\E.*\\Q") + "$"
    actualRequest.matches(wildcardRegex)
  }

}
