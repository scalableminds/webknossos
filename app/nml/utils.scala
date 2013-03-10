package nml

import scala.collection.immutable.HashMap

object utils {
  type NodeMapping = HashMap[Int, Node]
  type FunctionalNodeMapping = Function[Int, Int]

  type TreeMapping = HashMap[Int, (Int, NodeMapping)]

  def minNodeId(trees: List[TreeLike]) = {
    if (trees.isEmpty)
      0
    else
      trees.flatMap(_.nodes).map(_.id).min
  }

  def maxNodeId(trees: List[TreeLike]) = {
    if (trees.isEmpty)
      0
    else
      trees.flatMap(_.nodes).map(_.id).max
  }
}