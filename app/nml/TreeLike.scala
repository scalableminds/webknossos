package nml

import models.Color
import xml.XMLWrites
import xml.Xml
import play.api.libs.json.Writes
import play.api.libs.json.Json

trait TreeLike {
  def treeId: Int
  def color: Color
  def nodes: Set[Node]
  def edges: Set[Edge]

  def changeTreeId(id: Int): TreeLike
  
  def applyNodeMapping(f: Int => Int): TreeLike
}

object TreeLike{
    implicit object TreeLikeXMLWrites extends XMLWrites[TreeLike] {
    import Node.NodeXMLWrites
    import Edge.EdgeXMLWrites

    def writes(t: TreeLike) =
      <thing id={ t.treeId.toString } color.r={ t.color.r.toString } color.g={ t.color.g.toString } color.b={ t.color.b.toString } color.a={ t.color.a.toString }>
        <nodes>
          { t.nodes.map(n => Xml.toXML(n)) }
        </nodes>
        <edges>
          { t.edges.map(e => Xml.toXML(e)) }
        </edges>
      </thing>
  }

  implicit object DBTreeFormat extends Writes[TreeLike] {
    import Node.NodeFormat
    import Edge.EdgeFormat

    val ID = "id"
    val NODES = "nodes"
    val EDGES = "edges"
    val COLOR = "color"

    def writes(t: TreeLike) = Json.obj(
      ID -> t.treeId,
      NODES -> t.nodes,
      EDGES -> t.edges,
      COLOR -> t.color)
  }
}