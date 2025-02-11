package com.scalableminds.util.datastructures

import scala.annotation.tailrec

// based on https://codereview.stackexchange.com/questions/17621/disjoint-sets-implementation
class UnionFind[T](initialElements: Seq[T] = Nil) {

  /** Add a new single-node forest to the disjoint-set forests. It will be placed into its own set.
    */
  def add(elem: T): Unit =
    nodes += (elem -> UnionFind.Node(elem, 0, None))

  /** Union the disjoint-sets of which elem1 and elem2 are members of.
    */
  def union(elem1: T, elem2: T): Unit =
    // retrieve representative nodes
    (nodes.get(elem1).map(_.getRepresentative), nodes.get(elem2).map(_.getRepresentative)) match {
      // Distinguish the different union cases and return the new set representative

      // Case #1: both elements already in same set
      case (Some(n1), Some(n2)) if n1 == n2 =>
      // nothing to do

      // Case #2: rank1 > rank2 -> make n1 parent of n2
      case (Some(n1 @ UnionFind.Node(_, rank1, _)), Some(n2 @ UnionFind.Node(_, rank2, _))) if rank1 > rank2 =>
        n2.parent = Some(n1)

      // Case #3: rank1 < rank2 -> make n2 parent of n1
      case (Some(n1 @ UnionFind.Node(_, rank1, _)), Some(n2 @ UnionFind.Node(_, rank2, _))) if rank1 < rank2 =>
        n1.parent = Some(n2)

      // Case #4: rank1 == rank2 -> keep n1 as representative and increment rank
      case (Some(n1 @ UnionFind.Node(_, rank1, _)), Some(n2 @ UnionFind.Node(_, rank2, _))) =>
        n1.rank = rank1 + 1
        n2.parent = Some(n1)

      // we are guaranteed to find the two nodes in the map,
      // and the above cases cover all possibilities
      case _ => throw new MatchError("either element could not be found")
    }

  /** Finds the representative for a disjoint-set, of which elem is a member of.
    */
  def find(elem: T): Option[T] =
    nodes.get(elem) match {
      case Some(node) =>
        val rootNode = node.getRepresentative
        // path compression
        if (node != rootNode) node.parent = Some(rootNode)
        Some(rootNode.elem)
      case None => None
    }

  /** Returns the number of disjoint-sets managed in this data structure. Keep in mind: this is a non-vital/non-standard
    * operation, so we do not keep track of the number of sets, and instead this method recomputes them each time.
    */
  def size: Int =
    nodes.values.count(_.parent.isEmpty)

  ////
  // Internal parts
  private val nodes: scala.collection.mutable.Map[T, UnionFind.Node[T]] = scala.collection.mutable.Map.empty

  // Initialization
  initialElements.foreach(add)
}

object UnionFind {
  def apply[T](initialElements: Seq[T] = Nil) = new UnionFind[T](initialElements)

  private case class Node[T](elem: T, var rank: Int, var parent: Option[Node[T]]) {

    /** Compute representative of this set.
      * @return
      *   root element of the set
      */
    @tailrec
    final def getRepresentative: Node[T] = parent match {
      case None    => this
      case Some(p) => p.getRepresentative
    }
  }
}
