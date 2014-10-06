package oxalis.nml

object utils {
  type FunctionalNodeMapping = Function[Int, Int]

  def minNodeId(trees: Seq[TreeLike]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).min
  }

  def maxNodeId(trees: Seq[TreeLike]) = {
    val nodes = trees.flatMap(_.nodes)
    if (nodes.isEmpty)
      0
    else
      nodes.map(_.id).max
  }

  def maxTreeId(trees: List[TreeLike]) = {
    if (trees.isEmpty)
      0
    else
      trees.map(_.treeId).max
  }
}
