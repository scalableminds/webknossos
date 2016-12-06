package oxalis.nml

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.xml.{XMLWrites, Xml}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{Json, Writes}

trait TreeLike {
  def treeId: Int

  def color: Option[Color]

  def nodes: Set[Node]

  def edges: Set[Edge]

  def timestamp: Long

  def branchPoints: List[BranchPoint]

  def comments: List[Comment]

  def name: String

  def changeTreeId(id: Int): TreeLike

  def changeName(name: String): TreeLike

  def applyNodeMapping(f: Int => Int): TreeLike

  def addPrefix(prefix: String) =
    changeName(prefix + name)
}

object TreeLike {

  implicit object TreeLikeXMLWrites extends XMLWrites[TreeLike] with LazyLogging {
    def writes(t: TreeLike)(implicit writer: XMLStreamWriter): Fox[Boolean] = {
      Xml.withinElement("thing") {
        writer.writeAttribute("id", t.treeId.toString)
        writer.writeAttribute("color.r", t.color.map(_.r.toString).getOrElse(""))
        writer.writeAttribute("color.g", t.color.map(_.g.toString).getOrElse(""))
        writer.writeAttribute("color.b", t.color.map(_.b.toString).getOrElse(""))
        writer.writeAttribute("color.a", t.color.map(_.a.toString).getOrElse(""))
        writer.writeAttribute("name", t.name)
        for {
          _ <- Xml.withinElement("nodes")(Xml.toXML(t.nodes.toList.sortBy(_.id)))
          _ <- Xml.withinElement("edges")(Xml.toXML(t.edges.toList))
        } yield true
      }
    }
  }

  implicit object DBTreeFormat extends Writes[TreeLike] {

    import Edge.EdgeFormat
    import Node.NodeFormat

    val ID = "id"
    val NODES = "nodes"
    val EDGES = "edges"
    val COLOR = "color"
    val NAME = "name"
    val TIMESTAMP = "timestamp"
    val COMMENTS = "comments"
    val BRANCHPOINTS = "branchPoints"

    def writes(t: TreeLike) = Json.obj(
      ID -> t.treeId,
      NODES -> t.nodes,
      EDGES -> t.edges,
      NAME -> t.name,
      COLOR -> t.color,
      TIMESTAMP -> t.timestamp,
      COMMENTS -> t.comments,
      BRANCHPOINTS -> t.branchPoints)
  }

}
