package controllers

import com.google.inject.Inject
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.tools.Fox
import oxalis.security.WkEnv
import play.api.libs.ws.WSClient
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.WkConf

import scala.concurrent.ExecutionContext

class DemoProxyController @Inject()(ws: WSClient, conf: WkConf, sil: Silhouette[WkEnv])(implicit ec: ExecutionContext,
                                                                                        bodyParsers: PlayBodyParsers)
    extends Controller {

  private lazy val proxyMap: Map[String, String] = Map(
    "/" -> "https://example.org",
    "/faq" -> "https://example.org",
    "/features" -> "https://example.org",
    "/pricing" -> "https://example.org",
  )

  def matchesProxyPage(request: UserAwareRequest[WkEnv, AnyContent]): Boolean =
    conf.Features.isDemoInstance && proxyMap.contains(request.uri) && (request.identity.isEmpty || request.uri != "/")

  def proxyPageOrMainView: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    if (matchesProxyPage(request)) {
      ws.url(proxyMap(request.uri)).get().map(resp => Ok(resp.body).as("text/html"))
    } else Fox.successful(Ok(views.html.main(conf)))
  }
}
