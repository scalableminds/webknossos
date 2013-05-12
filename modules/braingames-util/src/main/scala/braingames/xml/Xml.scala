package braingames.xml

import scala.xml.Node

object Xml {
  def toXML[T](t: T)(implicit w: XMLWrites[T]): Node = w.writes(t)
}