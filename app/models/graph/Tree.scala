package models.graph

import brainflight.tools.geometry.Point3D
import models.Color
import play.api.libs.json.Writes
import play.api.libs.json.Json
import play.api.libs.json.JsObject
import xml.XMLWrites
import xml.Xml
import play.api.libs.json.Format
import play.api.libs.json.JsValue

case class Tree(id: Int, nodes: List[Node], edges: List[Edge], color: Color) {
  def addNodes(ns: List[Node]) = this.copy(nodes = nodes ::: ns)
  def addEdges(es: List[Edge]) = this.copy(edges = edges ::: es)
}

object Tree {
  implicit object TreeXMLWrites extends XMLWrites[Tree] {
    def writes(t: Tree) =
      <thing id={ t.id.toString } color.r={ t.color.r.toString } color.g={ t.color.g.toString } color.b={ t.color.b.toString } color.a={ t.color.a.toString }>
        <nodes>
          { t.nodes.map(n => Xml.toXML(n)) }
        </nodes>
        <edges>
          { t.edges.map(e => Xml.toXML(e)) }
        </edges>
      </thing>
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

  implicit object NodeFormat extends Format[Node] {
    val ID = "id"
    val RADIUS = "radius"
    val POSITION = "position"
    val VIEWPORT = "viewport"
    val RESOLUTION = "resolution"
    val TIMESTAMP = "timestamp"
    val COMMENT = "comment"

    def writes(n: Node): JsObject = {
      val j = Json.obj(
        ID -> n.id,
        RADIUS -> n.radius,
        POSITION -> n.position)
      n.comment match {
        case Some(c) => j ++ Json.obj("comment" -> c)
        case _       => j
      }
    }

    def reads(js: JsValue) =
      Node((js \ ID).as[Int],
        (js \ RADIUS).as[Float],
        (js \ POSITION).as[Point3D],
        (js \ VIEWPORT).as[Int],
        (js \ RESOLUTION).as[Int],
        (js \ TIMESTAMP).as[Long],
        (js \ COMMENT).asOpt[String])
  }

  implicit object TreeFormat extends Format[Tree] {
    val ID = "id"
    val NODES = "nodes"
    val EDGES = "edges"
    val COLOR = "color"

    def writes(t: Tree) = Json.obj(
        ID -> t.id,
        NODES -> t.nodes.map(NodeFormat.writes),
        EDGES -> t.edges,
        COLOR -> t.color)

    def reads(js: JsValue) =
      Tree((js \ ID).as[Int],
        (js \ NODES).as[List[Node]],
        (js \ EDGES).as[List[Edge]],
        (js \ COLOR).as[Color])

  }
}