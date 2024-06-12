package controllers

import com.google.inject.Inject
import play.silhouette.api.Silhouette
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.SitemapWriter

import scala.concurrent.ExecutionContext

class SitemapController @Inject()(sitemapWriter: SitemapWriter, sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  // Only called explicitly via RequestHandler
  def getSitemap(prefix: String): Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      sitemap <- sitemapWriter.getSitemap(prefix)
    } yield
      Ok(sitemap)
        .as(xmlMimeType)
        .withHeaders(CONTENT_DISPOSITION ->
          """sitemap.xml""")
  }

}
