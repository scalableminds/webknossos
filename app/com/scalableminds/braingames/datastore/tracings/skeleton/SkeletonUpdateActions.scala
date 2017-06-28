package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.image.Color
import com.scalableminds.braingames.datastore.tracings.skeleton.elements._
import play.api.libs.json.Json


trait SkeletonUpdateAction {
  def applyOn(tracing: SkeletonTracing): SkeletonTracing
}

case class CreateTreeSkeletonAction(id: Int, color: Option[Color], timestamp: Long, name: String,
                                    branchPoints: List[BranchPoint], comments: List[Comment]) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = {
    val newTree = Tree(id, Set(), Set(), color, branchPoints, comments, name)
    tracing.addTree(newTree)
  }
}

case class DeleteTreeSkeletonAction(id: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.deleteTree(id)
}

case class UpdateTreeSkeletonAction(id: Int, updatedId: Option[Int], color: Option[Color], name: String,
                                    branchPoints: List[BranchPoint], comments: List[Comment]) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) =
    tracing.updateTree(id, updatedId, color, name, branchPoints, comments)
}

case class MergeTreeSkeletonAction(sourceId: Int, targetId: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.mergeTree(sourceId, targetId)
}

case class MoveTreeComponentSkeletonAction(nodeIds: List[Int], sourceId: Int, targetId: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.moveTreeComponent(sourceId, targetId, nodeIds)
}

case class CreateEdgeSkeletonAction(source: Int, target: Int, treeId: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.addEdgeToTree(Edge(source, target), treeId)
}

case class DeleteEdgeSkeletonAction(source: Int, target: Int, treeId: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.deleteEdgeFromTree(Edge(source, target), treeId)
}


case class CreateNodeSkeletonAction(id: Int, position: Point3D, rotation: Option[Vector3D], radius: Option[Float],
                                    viewport: Option[Int], resolution: Option[Int], bitDepth: Option[Int],
                                    interpolation: Option[Boolean], treeId: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = {
    val newNode = Node.fromOptions(id, position, rotation, radius, viewport, resolution, bitDepth, interpolation)
    tracing.addNodeToTree(newNode, treeId)
  }
}

case class DeleteNodeSkeletonAction(nodeId: Int, treeId: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.deleteNodeFromTree(nodeId, treeId)
}

case class UpdateNodeSkeletonAction(id: Int, position: Point3D, rotation: Option[Vector3D], radius: Option[Float],
                                    viewport: Option[Int], resolution: Option[Int], bitDepth: Option[Int],
                                    interpolation: Option[Boolean], treeId: Int) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = {
    val newNode = Node.fromOptions(id, position, rotation, radius, viewport, resolution, bitDepth, interpolation)
    tracing.updateNodeInTree(newNode, treeId)
  }
}

case class UpdateTracingSkeletonAction(activeNode: Option[Int], editPosition: Option[Point3D],
                                       editRotation: Option[Vector3D], zoomLevel: Option[Double]) extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) =
    tracing.copy(
    activeNodeId = activeNode,
    editPosition = editPosition,
    editRotation = editRotation,
    zoomLevel = zoomLevel)
}



object CreateTreeSkeletonAction {implicit val jsonFormat = Json.format[CreateTreeSkeletonAction]}
object DeleteTreeSkeletonAction {implicit val jsonFormat = Json.format[DeleteTreeSkeletonAction]}
object UpdateTreeSkeletonAction {implicit val jsonFormat = Json.format[UpdateTreeSkeletonAction]}
object MergeTreeSkeletonAction {implicit val jsonFormat = Json.format[MergeTreeSkeletonAction]}
object MoveTreeComponentSkeletonAction {implicit val jsonFormat = Json.format[MoveTreeComponentSkeletonAction]}
object CreateEdgeSkeletonAction {implicit val jsonFormat = Json.format[CreateEdgeSkeletonAction]}
object DeleteEdgeSkeletonAction {implicit val jsonFormat = Json.format[DeleteEdgeSkeletonAction]}
object CreateNodeSkeletonAction {implicit val jsonFormat = Json.format[CreateNodeSkeletonAction]}
object DeleteNodeSkeletonAction {implicit val jsonFormat = Json.format[DeleteNodeSkeletonAction]}
object UpdateNodeSkeletonAction {implicit val jsonFormat = Json.format[UpdateNodeSkeletonAction]}
object UpdateTracingSkeletonAction {implicit val jsonFormat = Json.format[UpdateTracingSkeletonAction]}
