package utils

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.Xml
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import javax.inject.Inject
import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}
import models.binary.PublicationDAO
import play.api.libs.iteratee.Enumerator

import scala.concurrent.{ExecutionContext, Future}

case class SitemapURL(url: String,
                      lastMod: Option[String] = None,
                      changeFreq: Option[String] = None,
                      priority: Option[String] = None)

class SitemapWriter @Inject()(publicationDAO: PublicationDAO)(implicit ec: ExecutionContext) extends FoxImplicits {
  private lazy val outputService = XMLOutputFactory.newInstance()
  val standardPrefix = "https://webknossos.org"
  val standardURLs = List(SitemapURL("/"), SitemapURL("/features"), SitemapURL("/pricing"))

  def toSitemapStream(prefix: Option[String]) = Enumerator.outputStream { os =>
    implicit val writer: IndentingXMLStreamWriter =
      new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(os))

    for {
      sitemap <- toSitemap(prefix)
      _ = os.close()
    } yield sitemap
  }

  def toSitemap(prefix: Option[String])(implicit writer: XMLStreamWriter): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = writer.writeStartDocument()
      _ <- Xml.withinElement("urlset") {
        for {
          _ <- Future.successful(writer.writeAttribute("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9"))
          allUrls <- getAllURLs
          _ = allUrls.foreach(writeURL(_, prefix))
        } yield ()
      }
      _ = writer.writeEndDocument()
    } yield ()

  def writeURL(sitemapURL: SitemapURL, prefix: Option[String])(implicit writer: XMLStreamWriter) = {
    writer.writeStartElement("url")
    writeElement("loc", prefix.getOrElse(standardPrefix) + sitemapURL.url)
    sitemapURL.lastMod.foreach(writeElement("lastmod", _))
    sitemapURL.changeFreq.foreach(writeElement("changefreq", _))
    sitemapURL.priority.foreach(writeElement("priority", _))
    writer.writeEndElement()
  }

  def writeElement(element: String, value: String)(implicit writer: XMLStreamWriter) = {
    writer.writeStartElement(element)
    writer.writeCharacters(value)
    writer.writeEndElement()
  }

  def getAllURLs =
    for {
      publications <- publicationDAO.findAll(GlobalAccessContext)
    } yield standardURLs ::: publications.map(pub => SitemapURL("/publication/" + pub._id.id, None, Some("weekly")))

}
