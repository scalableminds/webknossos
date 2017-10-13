/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import java.util.UUID

import com.scalableminds.braingames.datastore.tracings.Tracing
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.image.Color
import play.api.libs.json.Json

case class SkeletonTracingDepr(dataSetName: String,
                               override val trees: List[TreeDepr] = SkeletonTracingDepr.defaultTrees,
                               timestamp: Long = SkeletonTracingDepr.defaultTimestamp,
                               boundingBox: Option[BoundingBox] = SkeletonTracingDepr.defaultBoundingBox,
                               activeNodeId: Option[Int] = SkeletonTracingDepr.defaultActiveNodeId,
                               editPosition: Point3D = SkeletonTracingDepr.defaultEditPosition,
                               editRotation: Vector3D = SkeletonTracingDepr.defaultEditRotation,
                               zoomLevel: Double = SkeletonTracingDepr.defaultZoomLevel,
                               version: Long = SkeletonTracingDepr.defaultVersion) extends Tracing {

  def addTree(newTree: TreeDepr): SkeletonTracingDepr =
    this.copy(trees = newTree :: this.trees)

  def deleteTree(treeId: Long) =
    this.copy(trees = this.trees.filter(_.treeId != treeId))

  def updateTree(id: Int, updatedId: Option[Int], color: Option[Color],
                 name: String, branchPoints: List[BranchPointDepr],
                 comments: List[CommentDepr]) = {
    def treeTransform(tree: TreeDepr) = tree.copy(
                                        color = color orElse tree.color,
                                        treeId = updatedId getOrElse id,
                                        branchPoints = branchPoints,
                                        comments = comments,
                                        name = name)

    this.copy(trees = mapTrees(id, treeTransform))
  }

  def mergeTree(sourceId: Int, targetId: Int) = {
    def treeTransform(targetTree: TreeDepr) = {
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
    val (movedBp, remainingBp) = sourceTree.branchPoints.partition(bp => nodeIds.contains(bp.nodeId))
    val (movedC, remainingC) = sourceTree.comments.partition(c => nodeIds.contains(c.nodeId))
    val updatedSource = sourceTree.copy(branchPoints = remainingBp, comments = remainingC,
                                        nodes = remainingNodes, edges = remainingEdges)
    val updatedTarget = targetTree.copy(branchPoints = movedBp ::: targetTree.branchPoints,
                                        comments = movedC ::: targetTree.comments, nodes = targetTree.nodes.union(movedNodes),
                                        edges = targetTree.edges.union(movedEdges))

    def selectTree(tree: TreeDepr) =
      if (tree.treeId == sourceId)
        updatedSource
      else if (tree.treeId == targetId)
        updatedTarget
      else tree

    this.copy(trees = this.trees.map(selectTree))
  }


  def addNodeToTree(newNode: NodeDepr, treeId: Int) = {
    def treeTransform(tree: TreeDepr) = tree.copy(nodes = tree.nodes + newNode)

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def deleteNodeFromTree(nodeId: Int, treeId: Int) = {
    def treeTransform(tree: TreeDepr) =
      tree.copy(nodes = tree.nodes.filter(_.id != nodeId),
                edges = tree.edges.filter(e => e.source != nodeId && e.target != nodeId))

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def updateNodeInTree(newNode: NodeDepr, treeId: Int) = {
    def treeTransform(tree: TreeDepr) =
      tree.copy(nodes = tree.nodes.map(n => if (n.id == newNode.id) newNode else n))

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def addEdgeToTree(edge: EdgeDepr, treeId: Int) = {
    def treeTransform(tree: TreeDepr) = tree.copy(edges = tree.edges + edge)

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  def deleteEdgeFromTree(edge: EdgeDepr, treeId: Int) = {
    def treeTransform(tree: TreeDepr) = tree.copy(edges = tree.edges.filter(_ != edge))

    this.copy(trees = mapTrees(treeId, treeTransform))
  }

  private def mapTrees(treeId: Int, transformTree: TreeDepr => TreeDepr): List[TreeDepr] = {
    this.trees.map((tree: TreeDepr) => if (tree.treeId == treeId) transformTree(tree) else tree)
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
      tree.branchPoints.forall { branchPoint => nodeIds.contains(branchPoint.nodeId)}
    }
  }
}

object SkeletonTracingDepr {
  implicit val jsonFormat = Json.format[SkeletonTracingDepr]

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
