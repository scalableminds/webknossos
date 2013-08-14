package oxalis.nml

import scala.collection.immutable.HashMap

object utils {
  type NodeMapping = HashMap[Int, Node]
  type FunctionalNodeMapping = Function[Int, Int]

  type TreeMapping = HashMap[Int, (Int, NodeMapping)]

  def minNodeId(trees: List[TreeLike]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).min
  }

  def maxNodeId(trees: List[TreeLike]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).max
  }
}