package controllers

import com.google.inject.Inject
import com.scalableminds.util.mvc.ControllerUtils
import org.apache.pekko.http.scaladsl.model.HttpHeader.ParsingResult.Ok
import play.silhouette.api.Silhouette
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}
import security.WkEnv
import utils.SitemapWriter

import scala.concurrent.ExecutionContext

class SitemapController @Inject() (sitemapWriter: SitemapWriter, sil: Silhouette[WkEnv], cc: ControllerComponents)(
    implicit ec: ExecutionContext
) extends AbstractController(cc)
    with WkControllerUtils {

  // Only called explicitly via RequestHandler
  def getSitemap(prefix: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      sitemap <- sitemapWriter.getSitemap(prefix)
    } yield Ok(sitemap)
      .as(xmlMimeType)
      .withHeaders(
        CONTENT_DISPOSITION ->
          """sitemap.xml"""
      )
  }

}
