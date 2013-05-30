package nml
import models.Color

case class Tree(treeId: Int, nodes: Set[Node], edges: Set[Edge], color: Color, name: String = "") extends TreeLike {

  def addNodes(ns: Set[Node]) = this.copy(nodes = nodes ++ ns)
  def addEdges(es: Set[Edge]) = this.copy(edges = edges ++ es)

  def timestamp =
    if (nodes.isEmpty)
      System.currentTimeMillis()
    else
      nodes.minBy(_.timestamp).timestamp

  def --(t: Tree) = {
    this.copy(nodes = nodes -- t.nodes, edges = edges -- t.edges)
  }

  def ++(t: Tree) = {
    this.copy(nodes = nodes ++ t.nodes, edges = edges ++ t.edges)
  }

  def changeTreeId(updatedTreeId: Int) = {
    this.copy(treeId = updatedTreeId)
  }

  def changeName(newName: String) = {
    this.copy(name = newName)
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