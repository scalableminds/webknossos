package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import java.util.UUID

import com.scalableminds.braingames.datastore.tracings.Tracing
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.image.Color
import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class SkeletonTracing(id: String = SkeletonTracing.defaultId,
                           dataSetName: String,
                           override val trees: List[Tree] = SkeletonTracing.defaultTrees,
                           timestamp: Long = SkeletonTracing.defaultTimestamp,
                           boundingBox: Option[BoundingBox] = SkeletonTracing.defaultBoundingBox,
                           activeNodeId: Option[Int] = SkeletonTracing.defaultActiveNodeId,
                           editPosition: Point3D = SkeletonTracing.defaultEditPosition,
                           editRotation: Vector3D = SkeletonTracing.defaultEditRotation,
                           zoomLevel: Double = SkeletonTracing.defaultZoomLevel,
                           version: Long = SkeletonTracing.defaultVersion) extends Tracing {

  def addTree(newTree: Tree): SkeletonTracing =
    this.copy(trees = newTree :: this.trees)

  def deleteTree(treeId: Long) =
    this.copy(trees = this.trees.filter(_.treeId != treeId))

  def updateTree(id: Int, updatedId: Option[Int], color: Option[Color],
                 name: String, branchPoints: List[BranchPoint],
                 comments: List[Comment]) = {
    def treeTransform(tree: Tree) = tree.copy(
                                        color = color orElse tree.color,
                                        treeId = updatedId getOrElse id,
                                        branchPoints = branchPoints,
                                        comments = comments,
                                        name = name)

    this.copy(trees = mapTrees(id, treeTransform))
  }

  def mergeTree(sourceId: Int, targetId: Int) = {
    def treeTransform(targetTree: Tree) = {
      val sourceTree = treeById(sourceId)
      targetTree.copy(nodes = targetTree.nodes.union(sourceTree.nodes),
                      edges = targetTree.edges.union(sourceTree.edges),
                      branchPoints = targetTree.branchPoints ::: sourceTree.branchPoints,
                      comments = targetTree.comments ::: sourceTree.comments)
    }

    this.copy(trees = mapTrees(targetId, treeTransform).filter(_.treeId != sourceId))
  }

  def moveTreeComponent(sourceId: Int, targetId: Int, nodeIds: List[Int]) = {
    val sourceTree = treeById(sourceId)
    val targetTree = treeById(targetId)

    val (movedNodes, remainingNodes) = sourceTree.nodes.partition(nodeIds contains _.id)
    val (movedEdges, remainingEdges) = sourceTree.edges.partition(e => nodeIds.contains(e.source) && nodeIds.contains(e.target))
    val (movedBp, remainingBp) = sourceTree.branchPoints.partition(bp => nodeIds.contains(bp.id))
    val (movedC, remainingC) = sourceTree.comments.partition(c => nodeIds.contains(c.node))
    val updatedSource = sourceTree.copy(branchPoints = remainingBp, comments = remainingC,
                                        nodes = remainingNodes, edges = remainingEdges)
    val updatedTarget = targetTree.copy(branchPoints = movedBp ::: targetTree.branchPoints,
                                        comments = movedC ::: targetTree.comments, nodes = targetTree.nodes.union(movedNodes),
                                        edges = targetTree.edges.union(movedEdges))

    def selectTree(tree: Tree) =
      if (tree.treeId == sourceId)
        updatedSource
      else if (tree.treeId == targetId)
        updatedTarget
      else tree

    this.copy(trees = this.trees.map(selectTree))
  }


  def addNodeToTree(newNode: Node, treeId: Int) = {
    def treeTransform(tree: Tree) = tree.copy(nodes = tree.nodes + newNode)

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def deleteNodeFromTree(nodeId: Int, treeId: Int) = {
    def treeTransform(tree: Tree) =
      tree.copy(nodes = tree.nodes.filter(_.id != nodeId),
                edges = tree.edges.filter(e => e.source != nodeId && e.target != nodeId))

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def updateNodeInTree(newNode: Node, treeId: Int) = {
    def treeTransform(tree: Tree) =
      tree.copy(nodes = tree.nodes.map(n => if (n.id == newNode.id) newNode else n))

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def addEdgeToTree(edge: Edge, treeId: Int) = {
    def treeTransform(tree: Tree) = tree.copy(edges = tree.edges + edge)

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def deleteEdgeFromTree(edge: Edge, treeId: Int) = {
    def treeTransform(tree: Tree) = tree.copy(edges = tree.edges.filter(_ != edge))

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  private def mapTrees(treeId: Int, transformTree: Tree => Tree): List[Tree] = {
    this.trees.map((tree: Tree) => if (tree.treeId == treeId) transformTree(tree) else tree)
  }

  private def treeById(id: Int) =
    trees.find(_.treeId == id)
      .getOrElse(throw new NoSuchElementException("Tracing does not contain tree with requested id " + id))

  def hasStrayEdges = {
    this.trees.forall { tree =>
      val nodeIds = tree.nodes.map(_.id)
      tree.edges.forall { edge =>
        nodeIds.contains(edge.source) && nodeIds.contains(edge.target)
      }
    }
  }
  def hasInvalidBranchpoints = {
    this.trees.forall { tree =>
      val nodeIds = tree.nodes.map(_.id)
      tree.branchPoints.forall { branchPoint => nodeIds.contains(branchPoint.id)}
    }
  }
}

object SkeletonTracing {
  implicit val jsonFormat = Json.format[SkeletonTracing]

  def defaultId = UUID.randomUUID.toString
  def defaultTrees = List()
  def defaultTimestamp = System.currentTimeMillis()
  def defaultBoundingBox = None
  def defaultActiveNodeId = None
  def defaultEditPosition = Point3D(0, 0, 0)
  def defaultEditRotation = Vector3D()
  def defaultZoomLevel = 2.0
  def defaultVersion = 0
}
