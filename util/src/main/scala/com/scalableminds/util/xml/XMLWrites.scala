package com.scalableminds.util.xml

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext.Implicits.global

trait XMLWrites[-T] {

  /**
    * Convert the object into a JsValue
    */
  def writes(o: T)(implicit writer: XMLStreamWriter): Fox[Boolean]
}

trait SynchronousXMLWrites[-T] extends XMLWrites[T] {

  def writes(o: T)(implicit writer: XMLStreamWriter): Fox[Boolean] =
    Fox.successful(synchronousWrites(o)(writer))

  def synchronousWrites(o: T)(implicit writer: XMLStreamWriter): Boolean
}
