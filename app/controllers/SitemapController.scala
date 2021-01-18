package controllers

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.mohiva.play.silhouette.api.Silhouette
import oxalis.security.WkEnv
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.mvc.{Action, AnyContent}
import utils.SitemapWriter

class SitemapController @Inject()(sitemapWriter: SitemapWriter, sil: Silhouette[WkEnv]) extends Controller {

  def getSitemap(prefix: Option[String] = None): Action[AnyContent] = sil.UserAwareAction {
    val downloadStream = sitemapWriter.toSitemapStream(prefix)

    Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(downloadStream)))
      .as("application/xml")
      .withHeaders(CONTENT_DISPOSITION ->
        """sitemap.xml""")
  }
}
