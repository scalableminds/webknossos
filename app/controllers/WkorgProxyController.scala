package controllers

import com.google.inject.Inject
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.user.{MultiUserDAO, Theme}
import oxalis.opengraph.{OpenGraphService, OpenGraphTags}
import oxalis.security.WkEnv
import play.api.libs.ws.WSClient
import play.api.mvc.{Action, AnyContent}
import utils.WkConf

import scala.concurrent.ExecutionContext
import scala.util.matching.Regex

class WkorgProxyController @Inject()(ws: WSClient,
                                     conf: WkConf,
                                     sil: Silhouette[WkEnv],
                                     multiUserDAO: MultiUserDAO,
                                     openGraphService: OpenGraphService)(implicit ec: ExecutionContext)
    extends Controller {

  def proxyPageOrMainView: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (matchesProxyPage(request)) {
      ws.url(conf.Proxy.prefix + request.uri).get().map(resp => Ok(resp.bodyAsBytes.utf8String).as("text/html"))
    } else {
      for {
        multiUserOpt <- Fox.runOptional(request.identity)(user =>
          multiUserDAO.findOne(user._multiUser)(GlobalAccessContext))
        openGraphTags <- openGraphService.getOpenGraphTags(request.path)
      } yield
        Ok(
          views.html.main(
            conf,
            multiUserOpt.map(_.selectedTheme).getOrElse(Theme.auto).toString,
            openGraphTags.title,
            openGraphTags.description,
            openGraphTags.image
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
