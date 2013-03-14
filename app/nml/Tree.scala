package nml
import models.Color

case class Tree(treeId: Int, nodes: Set[Node], edges: Set[Edge], color: Color, name: String = "") extends TreeLike{

  def addNodes(ns: Set[Node]) = this.copy(nodes = nodes ++ ns)
  def addEdges(es: Set[Edge]) = this.copy(edges = edges ++ es)

  def --(t: Tree) = {
    Tree(treeId, nodes -- t.nodes, edges -- t.edges, color)
  }

  def ++(t: Tree) = {
    Tree(treeId, nodes ++ t.nodes, edges ++ t.edges, color)
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
  def empty = Tree(1, Set.empty, Set.empty, Color(1, 0, 0, 0))
}