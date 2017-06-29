package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import com.scalableminds.util.image.Color
import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class Tree(
                 treeId: Int,
                 nodes: Set[Node],
                 edges: Set[Edge],
                 color: Option[Color],
                 branchPoints: List[BranchPoint],
                 comments: List[Comment],
                 name: String = "") {

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
      edges = edges.map(edge => edge.copy(source = f(edge.source), target = f(edge.target))),
      comments = comments.map(comment => comment.copy(node = f(comment.node))),
      branchPoints = branchPoints.map(bp => bp.copy(id = f(bp.id)))
    )
  }

  def addNamePrefix(prefix: String) = {
    this.copy(name = prefix + name)
  }
}

object Tree {implicit val jsonFormat = Json.format[Tree]}
