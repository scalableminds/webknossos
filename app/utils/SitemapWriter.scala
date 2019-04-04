package utils

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.Xml
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import javax.inject.Inject
import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}
import play.api.libs.iteratee.Enumerator

import scala.concurrent.ExecutionContext

class SitemapWriter @Inject()(implicit ec: ExecutionContext) extends FoxImplicits {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toSitemapStream() = Enumerator.outputStream { os =>
    implicit val writer: IndentingXMLStreamWriter =
      new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(os))

    for {
      sitemap <- toSitemap()
      _ = os.close()
    } yield sitemap
  }

  def toSitemap()(implicit writer: XMLStreamWriter): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      _ = Xml.withinElementSync("urlset") {
        writer.writeAttribute("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9")
      }
    } yield ()

}
