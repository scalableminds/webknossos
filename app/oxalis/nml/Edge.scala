package oxalis.nml

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json._

case class Edge(source: Int, target: Int)

object Edge {

  implicit object EdgeXMLWrites extends SynchronousXMLWrites[Edge] {
    def synchronousWrites(e: Edge)(implicit writer: XMLStreamWriter): Boolean = {
      writer.writeStartElement("edge")
      writer.writeAttribute("source", e.source.toString)
      writer.writeAttribute("target", e.target.toString)
      writer.writeEndElement()
      true
    }
  }

  implicit object EdgeFormat extends Format[Edge] {
    val SOURCE = "source"
    val TARGET = "target"

    def writes(e: Edge): JsObject = Json.obj(
      SOURCE -> e.source,
      TARGET -> e.target)

    def reads(js: JsValue): JsResult[Edge] =
      JsSuccess(Edge((js \ SOURCE).as[Int],
        (js \ TARGET).as[Int]))
  }

}
