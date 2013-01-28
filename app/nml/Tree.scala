package nml
import models.Color

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