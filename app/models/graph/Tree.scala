package models.graph

import brainflight.tools.geometry.Point3D
import models.Color
import play.api.libs.json.Writes
import play.api.libs.json.Json

case class Node(id: Int, radius: Float, position: Point3D, viewport: Int, resolution: Int, timestamp: Long, comment: Option[String] = None)

case class Edge(source: Node, target: Node)

case class Tree(id: Int, nodes: List[Node], edges: List[Edge], color: Color)

object Tree {
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
      n.comment match{
        case Some(c) => j ++ Json.obj("comment" -> c)
        case _ => j
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