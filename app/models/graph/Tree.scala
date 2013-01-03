package models.graph

import brainflight.tools.geometry.Point3D
import models.Color
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import play.api.libs.json.JsObject
import xml.XMLWrites
import xml.Xml
import play.api.libs.json.Format
import play.api.libs.json.JsValue
import play.api.data.validation.ValidationError

case class Tree(id: Int, nodes: List[Node], edges: List[Edge], color: Color) {
  def addNodes(ns: List[Node]) = this.copy(nodes = nodes ::: ns)
  def addEdges(es: List[Edge]) = this.copy(edges = edges ::: es)

  def --(t: Tree) = {
    Tree(id, nodes filterNot (t.nodes.contains), edges.filterNot(t.edges.contains), color)
  }

  def ++(t: Tree) = {
    Tree(id, (nodes ++ t.nodes).distinct, (edges ++ t.edges).distinct, color)
  }
}

object Tree {
  
  def empty = Tree(1, Nil, Nil, Color(1, 0, 0, 0))
  
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
    
    implicit def writes(e: Edge) = Json.obj(
      SOURCE -> e.source,
      TARGET -> e.target)

    implicit def reads(json: JsValue) = ((json \ SOURCE), json \ TARGET) match {
      case (JsNumber(s), JsNumber(t)) => JsSuccess(Edge(s.toInt, t.toInt))
      case _                          => JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.jsnumber"))))
    }

  }

  implicit val NodeFormat: Format[models.graph.Node] = (
    (__ \ "id").format[Int] and
    (__ \ "radius").format[Float] and
    (__ \ "position").format[Point3D] and
    (__ \ "viewport").format[Int] and
    (__ \ "resolution").format[Int] and
    (__ \ "timestamp").format[Long])(Node.apply, unlift(Node.unapply))

  implicit val treeFormat: Format[models.graph.Tree] = (
    (__ \ "id").format[Int] and
    (__ \ "nodes").format[List[Node]] and
    (__ \ "edges").format[List[Edge]] and
    (__ \ "color").format[Color])(Tree.apply, unlift(Tree.unapply))
}