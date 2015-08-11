package oxalis.nml

import com.scalableminds.util.image.Color
import com.scalableminds.util.xml.{SynchronousXMLWrites, XMLWrites, Xml}
import play.api.libs.json.Writes
import play.api.libs.json.Json
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.xml.XMLUtils._

trait TreeLike {
  def treeId: Int
  def color: Option[Color]
  def nodes: Set[Node]
  def edges: Set[Edge]
  def timestamp: Long

  def name: String
  def changeTreeId(id: Int): TreeLike
  def changeName(name: String): TreeLike

  def applyNodeMapping(f: Int => Int): TreeLike

  def addPrefix(prefix: String) =
    changeName(prefix + name)
}

object TreeLike{
    implicit object TreeLikeXMLWrites extends XMLWrites[TreeLike] {
    import Node.NodeXMLWrites
    import Edge.EdgeXMLWrites

    def writes(t: TreeLike) =
      for{
        nodes <- Xml.toXML(t.nodes.toSeq.sortBy(_.id))
        edges <- Xml.toXML(t.edges.toSeq)
      } yield {
        <thing id={ t.treeId.toString } color.r={ t.color.map(_.r.toString) } color.g={ t.color.map(_.g.toString) } color.b={ t.color.map(_.b.toString) } color.a={ t.color.map(_.a.toString) } name={t.name}>
          <nodes>
            { nodes}
          </nodes>
          <edges>
            { edges }
          </edges>
        </thing>
      }
  }

  implicit object DBTreeFormat extends Writes[TreeLike] {
    import Node.NodeFormat
    import Edge.EdgeFormat

    val ID = "id"
    val NODES = "nodes"
    val EDGES = "edges"
    val COLOR = "color"
    val NAME = "name"
    val TIMESTAMP = "timestamp"

    def writes(t: TreeLike) = Json.obj(
      ID -> t.treeId,
      NODES -> t.nodes,
      EDGES -> t.edges,
      NAME -> t.name,
      COLOR -> t.color,
      TIMESTAMP -> t.timestamp)
  }
}
