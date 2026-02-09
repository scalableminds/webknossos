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
import play.twirl.api.HtmlFormat
import play.api.Environment
import scala.io.Source
import models.user.Theme

import scala.concurrent.ExecutionContext
import scala.util.matching.Regex

class AboutPageRedirectController @Inject()(conf: WkConf,
                                            sil: Silhouette[WkEnv],
                                            val cspConfig: CSPConfig,
                                            multiUserDAO: MultiUserDAO,
                                            openGraphService: OpenGraphService,
                                            environment: Environment,
                                            assets: controllers.Assets)(implicit ec: ExecutionContext)
    extends Controller
    with CspHeaders {

  private lazy val indexHtmlTemplate: String = {
    environment
      .resourceAsStream("public/index.html")
      .map(is => Source.fromInputStream(is).mkString)
      .getOrElse("Error: index.html not found")
  }

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
      } yield {
        val theme = getTheme(multiUserOpt)
        val themeCss = getThemeCss(theme)
        val openGraphMeta = getOpenGraphMeta(openGraphTags)
        val wkOrgMeta = getWkOrgMeta
        val airbrakeConfig = getAirbrakeConfig

        val html = indexHtmlTemplate
          .replace("""<meta name="commit-hash" content="" />""",
                   s"""<meta name="commit-hash" content="${webknossos.BuildInfo.commitHash}" />""")
          .replace("""<meta name="selected-theme" content="" />""",
                   s"""<meta name="selected-theme" content="$theme" />""")
          .replace("<!-- INJECT_THEME_CSS -->", themeCss)
          .replace("<!-- INJECT_OPENGRAPH_METADATA -->", openGraphMeta)
          .replace("<!-- INJECT_WKORG_METADATA -->", wkOrgMeta)
          .replace("<!-- INJECT_AIRBRAKE_CONFIG -->", airbrakeConfig)

        Ok(html).as("text/html").withHeaders(addCspHeader(Ok).header.headers.toSeq: _*)
      }
    }
  }

  private def getTheme(multiUserOpt: Option[MultiUser]): String =
    multiUserOpt.map(_.selectedTheme.toString).getOrElse("auto")

  private def getThemeCss(theme: String): String =
    theme match {
      case "auto" => "<style>@media (prefers-color-scheme: dark) { html { background: black } }</style>"
      case "dark" => "<style>html { background: black }</style>"
      case _      => ""
    }

  private def getOpenGraphMeta(openGraphTags: OpenGraphTags): String =
    List(
      openGraphTags.title.map(t => s"""<meta property="og:title" content="${HtmlFormat.escape(t)}" />"""),
      openGraphTags.description.map(d => s"""<meta property="og:description" content="${HtmlFormat.escape(d)}" />"""),
      openGraphTags.image.map(i => s"""<meta property="og:image" content="${HtmlFormat.escape(i)}" />""")
    ).flatten.mkString("\n    ")

  private def getWkOrgMeta: String =
    if (conf.Features.isWkorgInstance) {
      """<meta
      name="description"
      content="Annotate and explore large 3D datasets with WEBKNOSSOS. Fast neurite skeletonization. 3D voxel painting. Collaboration, sharing and crowdsourcing."
    />
    <meta
      name="keywords"
      content="connectomics, data annotation, image segmentation, electron microscopy, light microscopy, fluorescence microscopy, skeletonization, webknossos"
    />"""
    } else {
      ""
    }

  private def getAirbrakeConfig: String =
    s"""<script
      data-airbrake-project-id="${conf.Airbrake.projectID}"
      data-airbrake-project-key="${conf.Airbrake.projectKey}"
      data-airbrake-environment-name="${conf.Airbrake.environment}"
    ></script>"""

  private def matchesRedirectRoute(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isWkorgInstance && conf.AboutPageRedirect.routes.exists(route =>
      matchesRouteWithWildcard(route, request.path)) && (request.identity.isEmpty || request.uri != "/")

  private def matchesRouteWithWildcard(routeWithWildcard: String, actualRequest: String): Boolean = {
    val wildcardRegex = "^" + Regex.quote(routeWithWildcard).replace("*", "\\E.*\\Q") + "$"
    actualRequest.matches(wildcardRegex)
  }

}
