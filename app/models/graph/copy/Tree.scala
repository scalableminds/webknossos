package models.graph.copy

import brainflight.tools.geometry.Point3D
import models.Color
import play.api.libs.json.Writes
import play.api.libs.json.Json
import play.api.libs.json.JsObject
import xml.XMLWrites
import xml.Xml
import play.api.libs.json.Format
import play.api.libs.json.JsValue
import play.api.Logger

case class Tree(treeId: Int, nodes: List[Node], edges: List[Edge], color: Color) {
  
  def addNodes(ns: List[Node]) = this.copy(nodes = nodes ::: ns)
  def addEdges(es: List[Edge]) = this.copy(edges = edges ::: es)
  
  def --(t: Tree) = {
    Tree(treeId, nodes filterNot(t.nodes.contains), edges.filterNot(t.edges.contains), color)
  }
  
  def ++(t:Tree) = {
    Tree(treeId, (nodes ++ t.nodes).distinct, (edges ++ t.edges).distinct, color)
  }
  
}

object Tree {
  
  def empty = Tree(1, Nil, Nil, Color(1, 0, 0, 0))

}