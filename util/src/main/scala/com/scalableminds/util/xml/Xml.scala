package com.scalableminds.util.xml

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext.Implicits._

object Xml {
  def withinElement[T](name: String)(f: => Fox[T])(implicit writer: XMLStreamWriter): Fox[T] = {
    writer.writeStartElement(name)
    f.map { r =>
      writer.writeEndElement()
      r
    }
  }

  def withinElementSync(name: String)(f: => Any)(implicit writer: XMLStreamWriter) = {
    writer.writeStartElement(name)
    f
    writer.writeEndElement()
  }

  def toXML[T](t: T)(implicit writer: XMLStreamWriter, w: XMLWrites[T]): Fox[Boolean] =
    w.writes(t)

  def toXML[T](t: List[T])(implicit writer: XMLStreamWriter, w: XMLWrites[T]): Fox[List[Boolean]] =
    Fox.serialCombined(t)(w.writes)
}
