package controllers

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.mohiva.play.silhouette.api.Silhouette
import oxalis.security.WkEnv
import play.api.libs.iteratee.streams.IterateeStreams
import utils.SitemapWriter

import scala.concurrent.ExecutionContext

class SitemapController @Inject()(sitemapWriter: SitemapWriter, sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  def getSitemap(prefix: Option[String] = None) = sil.UserAwareAction { implicit request =>
    val downloadStream = sitemapWriter.toSitemapStream(prefix)

    Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(downloadStream)))
      .as("application/xml")
      .withHeaders(CONTENT_DISPOSITION ->
        """sitemap.xml""")
  }
}
