/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json.Json

case class Comment(
  node: Int,
  content: String)

object Comment {
  implicit val jsonFormat = Json.format[Comment]

  implicit object CommentXMLWrites extends SynchronousXMLWrites[Comment] {
    def synchronousWrites(n: Comment)(implicit writer: XMLStreamWriter): Boolean = {
      writer.writeStartElement("comment")
      writer.writeAttribute("node", n.node.toString)
      writer.writeAttribute("content", n.content)
      writer.writeEndElement()
      true
    }
  }

}
