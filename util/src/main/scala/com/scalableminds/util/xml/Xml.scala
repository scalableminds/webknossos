package com.scalableminds.util.xml

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.tools.Fox

object Xml {
  def withinElement[T](name: String)(f: => Fox[T])(implicit writer: XMLStreamWriter): Fox[T] = {
    writer.writeStartElement(name)
    f.map { r =>
      writer.writeEndElement()
      r
    }
  }

  def withinElementSync(name: String)(f: => Any)(implicit writer: XMLStreamWriter): Unit = {
    writer.writeStartElement(name)
    f
    writer.writeEndElement()
  }
}
