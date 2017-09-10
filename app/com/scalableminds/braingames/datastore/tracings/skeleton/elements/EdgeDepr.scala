/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json.Json

case class EdgeDepr(
  source: Int,
  target: Int)

object EdgeDepr {
  implicit val jsonFormat = Json.format[EdgeDepr]

  implicit object EdgeXMLWrites extends SynchronousXMLWrites[EdgeDepr] {
    def synchronousWrites(e: EdgeDepr)(implicit writer: XMLStreamWriter): Boolean = {
      writer.writeStartElement("edge")
      writer.writeAttribute("source", e.source.toString)
      writer.writeAttribute("target", e.target.toString)
      writer.writeEndElement()
      true
    }
  }
}
