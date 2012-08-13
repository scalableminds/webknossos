package models.graph

import brainflight.tools.geometry.Point3D
import models.Color
import play.api.libs.json.Writes
import play.api.libs.json.Json
import xml.XMLWrites
import xml.Xml

case class Tree(id: Int, nodes: List[Node], edges: List[Edge], color: Color){
  def addNodes(ns: List[Node]) = this.copy( nodes = nodes ::: ns)
  def addEdges(es: List[Edge]) = this.copy( edges = edges ::: es)
}

object Tree {
  implicit object TreeXMLWrites extends XMLWrites[Tree]{
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
  implicit object EdgeWrites extends Writes[Edge] {
    def writes(e: Edge) = Json.obj(
      "source" -> e.source.id,
      "target" -> e.target.id)
  }

  implicit object NodeWrites extends Writes[Node] {
    def writes(n: Node) = {
      val j = Json.obj(
        "id" -> n.id,
        "radius" -> n.radius,
        "position" -> n.position)
      n.comment match {
        case Some(c) => j ++ Json.obj("comment" -> c)
        case _       => j
      }
    }
  }

  implicit object TreeWrites extends Writes[Tree] {
    def writes(t: Tree) = Json.obj(
      "id" -> t.id,
      "nodes" -> t.nodes,
      "edges" -> t.edges,
      "color" -> t.color)
  }
}