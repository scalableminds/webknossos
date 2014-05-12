package com.scalableminds.util.xml

import scala.xml.Node
import scala.concurrent.ExecutionContext.Implicits._
import com.scalableminds.util.tools.Fox
import scala.collection.breakOut


object Xml {
  def toXML[T](t: T)(implicit w: XMLWrites[T]): Fox[Node] = w.writes(t)
  def toXML[T](t: Seq[T])(implicit w: XMLWrites[T]): Fox[List[Node]] = Fox.combined(t.map(w.writes(_))(breakOut))
}