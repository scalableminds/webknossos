package xml

import scala.xml.Node

trait XMLWrites[-T] {

  /**
   * Convert the object into a JsValue
   */
  def writes(o: T): Node

}