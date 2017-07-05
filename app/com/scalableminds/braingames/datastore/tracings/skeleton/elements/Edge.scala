package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class Edge(
  source: Int,
  target: Int)

object Edge {
  implicit val jsonFormat = Json.format[Edge]

  implicit object EdgeXMLWrites extends SynchronousXMLWrites[Edge] {
    def synchronousWrites(e: Edge)(implicit writer: XMLStreamWriter): Boolean = {
      writer.writeStartElement("edge")
      writer.writeAttribute("source", e.source.toString)
      writer.writeAttribute("target", e.target.toString)
      writer.writeEndElement()
      true
    }
  }
}
