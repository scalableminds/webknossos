package nml

import xml.XMLWrites
import play.api.libs.json._

case class Edge(source: Int, target: Int)

object Edge {
  implicit object EdgeXMLWrites extends XMLWrites[Edge] {
    def writes(e: Edge) = {
      <edge source={ e.source.toString } target={ e.target.toString }/>
    }
  }

  implicit object EdgeFormat extends Format[Edge] {
    val SOURCE = "source"
    val TARGET = "target"
    def writes(e: Edge) = Json.obj(
      SOURCE -> e.source,
      TARGET -> e.target)

    def reads(js: JsValue) =
      JsSuccess(Edge((js \ SOURCE).as[Int],
        (js \ TARGET).as[Int]))

  }
}