package com.scalableminds.util.xml

import scala.xml.Node
import com.scalableminds.util.tools.Fox
import scala.concurrent.ExecutionContext.Implicits.global

trait XMLWrites[-T] {

  /**
   * Convert the object into a JsValue
   */
  def writes(o: T): Fox[Node]
}

trait SynchronousXMLWrites[-T] extends XMLWrites[T] {

  def writes(o: T) =
    Fox.successful(synchronousWrites(o))

  def synchronousWrites(o: T): Node
}