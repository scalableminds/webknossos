/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json.Json

case class CommentDepr(
                        nodeId: Int,
                        content: String)

object CommentDepr {
  implicit val jsonFormat = Json.format[CommentDepr]

  implicit object CommentXMLWrites extends SynchronousXMLWrites[CommentDepr] {
    def synchronousWrites(n: CommentDepr)(implicit writer: XMLStreamWriter): Boolean = {
      writer.writeStartElement("comment")
      writer.writeAttribute("node", n.nodeId.toString)
      writer.writeAttribute("content", n.content)
      writer.writeEndElement()
      true
    }
  }

}
