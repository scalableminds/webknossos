package controllers

import com.google.inject.Inject
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mvc.CspHeaders
import com.scalableminds.util.tools.Fox
import models.user.{MultiUser, MultiUserDAO, Theme}
import opengraph.{OpenGraphService, OpenGraphTags}
import play.api.mvc.{Action, AnyContent}
import play.filters.csp.CSPConfig
import security.WkEnv
import utils.WkConf
import play.twirl.api.HtmlFormat
import play.api.Environment

import scala.io.Source
import scala.concurrent.ExecutionContext
import scala.util.matching.Regex

class AboutPageRedirectController @Inject()(conf: WkConf,
                                            sil: Silhouette[WkEnv],
                                            val cspConfig: CSPConfig,
                                            multiUserDAO: MultiUserDAO,
                                            openGraphService: OpenGraphService,
                                            environment: Environment)(implicit ec: ExecutionContext)
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
        mainViewTemplate <- mainViewTemplateOpt.toFox ?~> "Could not load main view template"
        mainView = renderMainViewFromTemplate(mainViewTemplate, multiUserOpt, openGraphTags)
      } yield addCspHeader(Ok(mainView).as("text/html"))
    }
  }

  private def renderMainViewFromTemplate(mainViewTemplate: String,
                                         multiUserOpt: Option[MultiUser],
                                         openGraphTags: OpenGraphTags): String = {
    val themeName = multiUserOpt.map(_.selectedTheme).getOrElse(Theme.auto).toString
    mainViewTemplate
      .replace("""<meta name="commit-hash" content="" />""",
               s"""<meta name="commit-hash" content="${webknossos.BuildInfo.commitHash}" />""")
      .replace("""<meta name="selected-theme" content="" />""",
               s"""<meta name="selected-theme" content="$themeName" />""")
      .replace("<!-- INJECT_THEME_CSS -->", renderThemeCss(multiUserOpt))
      .replace("<!-- INJECT_OPENGRAPH_METADATA -->", renderOpenGraphMetadata(openGraphTags))
      .replace("<!-- INJECT_WKORG_METADATA -->", wkOrgMetadata)
      .replace("<!-- INJECT_AIRBRAKE_CONFIG -->", airbrakeConfig)
  }

  private def renderThemeCss(multiUserOpt: Option[MultiUser]): String =
    multiUserOpt.map(_.selectedTheme) match {
      case Some(Theme.dark)  => "<style>html { background: black }</style>"
      case Some(Theme.light) => ""
      case _ =>
        "<style>@media (prefers-color-scheme: dark) { html { background: black } }</style>"
    }

  private def renderOpenGraphMetadata(openGraphTags: OpenGraphTags): String =
    List(
      openGraphTags.title.map(t => s"""<meta property="og:title" content="${HtmlFormat.escape(t)}" />"""),
      openGraphTags.description.map(d => s"""<meta property="og:description" content="${HtmlFormat.escape(d)}" />"""),
      openGraphTags.image.map(i => s"""<meta property="og:image" content="${HtmlFormat.escape(i)}" />""")
    ).flatten.mkString("\n    ")

  private lazy val wkOrgMetadata: String =
    if (conf.Features.isWkorgInstance) {
      """<meta
      name="description"
      content="Annotate and explore large 3D datasets with WEBKNOSSOS. Fast neurite skeletonization. 3D voxel painting. Collaboration, sharing and crowdsourcing."
    />
    <meta
      name="keywords"
      content="connectomics, data annotation, image segmentation, electron microscopy, light microscopy, fluorescence microscopy, skeletonization, webknossos"
    />"""
    } else ""

  private lazy val airbrakeConfig: String =
    s"""<script
      data-airbrake-project-id="${conf.Airbrake.projectID}"
      data-airbrake-project-key="${conf.Airbrake.projectKey}"
      data-airbrake-environment-name="${conf.Airbrake.environment}"
    ></script>"""

  private lazy val mainViewTemplateOpt: Option[String] =
    environment.resourceAsStream("public/index.html").map(is => Source.fromInputStream(is).mkString)

  private def matchesRedirectRoute(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isWkorgInstance && conf.AboutPageRedirect.routes.exists(route =>
      matchesRouteWithWildcard(route, request.path)) && (request.identity.isEmpty || request.uri != "/")

  private def matchesRouteWithWildcard(routeWithWildcard: String, actualRequest: String): Boolean = {
    val wildcardRegex = "^" + Regex.quote(routeWithWildcard).replace("*", "\\E.*\\Q") + "$"
    actualRequest.matches(wildcardRegex)
  }

}
