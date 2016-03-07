package oxalis.nml

import com.scalableminds.util.image.Color
import com.scalableminds.util.geometry.{Vector3D, Point3D}

case class Tree(treeId: Int, nodes: Set[Node], edges: Set[Edge], color: Option[Color], name: String = "") extends TreeLike {

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

  def addNamePrefix(prefix: String) = {
    this.copy(name = prefix + name)
  }
}

object Tree {
  def empty = Tree(1, Set.empty, Set.empty, None)

<<<<<<< HEAD
  def createFrom(node: Point3D) =
    Tree(1, Set(Node(1, node)), Set.empty, None)
=======
  def createFrom(node: Point3D, rotation: Vector3D) =
    Tree(1, Set(Node(1, node, rotation)), Set.empty, Color.RED)
>>>>>>> 777b966dea8460009c7c78dfd25fd855a0f7da08
}
