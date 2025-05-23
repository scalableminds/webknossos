package utils

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.Xml
import com.sun.xml.txw2.output.IndentingXMLStreamWriter

import javax.inject.Inject
import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}
import models.dataset.PublicationDAO
import org.apache.commons.io.output.ByteArrayOutputStream

import java.nio.charset.StandardCharsets
import scala.concurrent.ExecutionContext

case class SitemapURL(url: String,
                      lastMod: Option[String] = None,
                      changeFreq: Option[String] = None,
                      priority: Option[String] = None)

class SitemapWriter @Inject()(publicationDAO: PublicationDAO, wkConf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits {
  private val proxyURLs = wkConf.AboutPageRedirect.routes.filter(!_.contains("*")).map(SitemapURL(_))
  private lazy val outputFactory = XMLOutputFactory.newInstance()

  def getSitemap(prefix: String): Fox[String] = {
    val os = new ByteArrayOutputStream()
    implicit val writer: IndentingXMLStreamWriter =
      new IndentingXMLStreamWriter(outputFactory.createXMLStreamWriter(os))

    for {
      _ <- writeSitemapWithImplicitWriter(prefix)
      _ = os.close()
    } yield new String(os.toByteArray, StandardCharsets.UTF_8)
  }

  private def writeSitemapWithImplicitWriter(prefix: String)(implicit writer: XMLStreamWriter): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = writer.writeStartDocument()
      _ <- Xml.withinElement("urlset") {
        for {
          _ <- Fox.successful(writer.writeAttribute("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9"))
          allUrls <- getAllURLs
          _ = allUrls.foreach(writeURL(_, prefix))
        } yield ()
      }
      _ = writer.writeEndDocument()
    } yield ()

  private def writeURL(sitemapURL: SitemapURL, prefix: String)(implicit writer: XMLStreamWriter): Unit = {
    writer.writeStartElement("url")
    writeElement("loc", prefix + sitemapURL.url)
    sitemapURL.lastMod.foreach(writeElement("lastmod", _))
    sitemapURL.changeFreq.foreach(writeElement("changefreq", _))
    sitemapURL.priority.foreach(writeElement("priority", _))
    writer.writeEndElement()
  }

  private def writeElement(element: String, value: String)(implicit writer: XMLStreamWriter): Unit = {
    writer.writeStartElement(element)
    writer.writeCharacters(value)
    writer.writeEndElement()
  }

  private def getAllURLs: Fox[List[SitemapURL]] =
    for {
      publications <- publicationDAO.findAll(GlobalAccessContext)
    } yield proxyURLs ::: publications.map(pub => SitemapURL("/publication/" + pub._id.id, None, Some("weekly")))

}
