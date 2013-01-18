package models.graph.copy

import xml.XMLWrites
import play.api.libs.json.Format
import play.api.libs.json.Json
import play.api.libs.json.JsValue

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
      Edge((js \ SOURCE).as[Int],
        (js \ TARGET).as[Int])

  }
}