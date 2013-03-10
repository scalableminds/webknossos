package nml
import models.Color

case class Tree(treeId: Int, nodes: List[Node], edges: List[Edge], color: Color) extends TreeLike {

  def addNodes(ns: List[Node]) = this.copy(nodes = nodes ::: ns)
  def addEdges(es: List[Edge]) = this.copy(edges = edges ::: es)

  def --(t: Tree) = {
    Tree(treeId, nodes filterNot (t.nodes.contains), edges.filterNot(t.edges.contains), color)
  }

  def ++(t: Tree) = {
    Tree(treeId, (nodes ++ t.nodes).distinct, (edges ++ t.edges).distinct, color)
  }

  def changeTreeId(updatedTreeId: Int) = {
    this.copy(treeId = updatedTreeId)
  }

  def applyNodeMapping(f: Int => Int) = {
    this.copy(
      nodes = nodes.map(node => node.copy(id = f(node.id))),
      edges = edges.map(edge => edge.copy(source = f(edge.source), target = f(edge.target))))
  }
}

object Tree {

  def empty = Tree(1, Nil, Nil, Color(1, 0, 0, 0))

}