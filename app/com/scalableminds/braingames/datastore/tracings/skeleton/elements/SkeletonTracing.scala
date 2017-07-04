package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.braingames.datastore.tracings.Tracing
import com.scalableminds.util.geometry.{Point3D, Scale, Vector3D}
import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.xml.{SynchronousXMLWrites, XMLWrites, Xml}
import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class SkeletonTracing(id: String,
                           name: String,
                           dataSetName: String,
                           trees: List[Tree],
                           timestamp: Long,
                           activeNodeId: Option[Int],
                           scale: Scale,
                           editPosition: Option[Point3D],
                           editRotation: Option[Vector3D],
                           zoomLevel: Option[Double]) extends Tracing {

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
                                        comments = movedC ::: targetTree.comments, nodes = movedNodes, edges = movedEdges)

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
}

object SkeletonTracing {
  implicit val jsonFormat = Json.format[SkeletonTracing]

  implicit object SkeletonTracingXMLWrites extends XMLWrites[SkeletonTracing] {
    def writes(e: SkeletonTracing)(implicit writer: XMLStreamWriter): Fox[Boolean] = {
      Xml.withinElement("things") {
        for {
          //TODO: _ <- Xml.withinElement("parameters")(AnnotationContent.writeParametersAsXML(e, writer))
          _ <- Xml.toXML(e.trees.filterNot(_.nodes.isEmpty))
          _ <- Xml.withinElement("branchpoints")(Xml.toXML(e.trees.flatMap(_.branchPoints).sortBy(-_.timestamp)))
          _ <- Xml.withinElement("comments")(Xml.toXML(e.trees.flatMap(_.comments)))
        } yield true
      }
    }
  }
}
