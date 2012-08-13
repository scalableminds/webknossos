package xml

import scala.xml.Node

abstract class XMLWrites[T] {
  def writes( t: T): Node
}