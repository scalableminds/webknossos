/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.skeleton.updating

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton._
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import play.api.libs.json._


case class CreateTreeSkeletonAction(id: Int, color: Option[com.scalableminds.util.image.Color], name: String,
                                    branchPoints: List[UpdateActionBranchPoint], timestamp: Long, comments: List[UpdateActionComment]) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    val newTree = Tree(id, Nil, Nil, convertColorOpt(color), branchPoints.map(convertBranchPoint), comments.map(convertComment), name, timestamp)
    tracing.withTrees(newTree +: tracing.trees)
  }
}

case class DeleteTreeSkeletonAction(id: Int) extends UpdateAction.SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.withTrees(tracing.trees.filter(_.treeId != id))
}

case class UpdateTreeSkeletonAction(id: Int, updatedId: Option[Int], color: Option[com.scalableminds.util.image.Color], name: String,
                                    branchPoints: List[UpdateActionBranchPoint], comments: List[UpdateActionComment]) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(tree: Tree) =
      tree
        .withColor(convertColorOpt(color) getOrElse tree.getColor)
        .withTreeId(updatedId.getOrElse(tree.treeId))
        .withBranchPoints(branchPoints.map(convertBranchPoint))
        .withComments(comments.map(convertComment))
        .withName(name)

    tracing.withTrees(mapTrees(tracing, id, treeTransform))
  }
}

case class MergeTreeSkeletonAction(sourceId: Int, targetId: Int) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(targetTree: Tree) = {
      val sourceTree = treeById(tracing, sourceId)
      targetTree
        .withNodes(targetTree.nodes.union(sourceTree.nodes))
        .withEdges(targetTree.edges.union(sourceTree.edges))
        .withBranchPoints(targetTree.branchPoints ++ sourceTree.branchPoints)
        .withComments(targetTree.comments ++ sourceTree.comments)
    }

    tracing.withTrees(mapTrees(tracing, targetId, treeTransform).filter(_.treeId != sourceId))
  }
}

case class MoveTreeComponentSkeletonAction(nodeIds: List[Int], sourceId: Int, targetId: Int) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    val sourceTree = treeById(tracing, sourceId)
    val targetTree = treeById(tracing, targetId)

    val (movedNodes, remainingNodes) = sourceTree.nodes.partition(nodeIds contains _.id)
    val (movedEdges, remainingEdges) = sourceTree.edges.partition(e => nodeIds.contains(e.source) && nodeIds.contains(e.target))
    val (movedBp, remainingBp) = sourceTree.branchPoints.partition(bp => nodeIds.contains(bp.nodeId))
    val (movedC, remainingC) = sourceTree.comments.partition(c => nodeIds.contains(c.nodeId))
    val updatedSource = sourceTree.copy(branchPoints = remainingBp, comments = remainingC,
      nodes = remainingNodes, edges = remainingEdges)
    val updatedTarget = targetTree.copy(branchPoints = movedBp ++ targetTree.branchPoints,
      comments = movedC ++ targetTree.comments, nodes = targetTree.nodes.union(movedNodes),
      edges = targetTree.edges.union(movedEdges))

    def selectTree(tree: Tree) =
      if (tree.treeId == sourceId)
        updatedSource
      else if (tree.treeId == targetId)
        updatedTarget
      else tree

    tracing.withTrees(tracing.trees.map(selectTree))
  }
}

case class CreateEdgeSkeletonAction(source: Int, target: Int, treeId: Int) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(tree: Tree) = tree.withEdges(Edge(source, target) +: tree.edges)
    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }
}

case class DeleteEdgeSkeletonAction(source: Int, target: Int, treeId: Int) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(tree: Tree) = tree.copy(edges = tree.edges.filter(_ != Edge(source, target)))
    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }
}


case class CreateNodeSkeletonAction(id: Int, position: Point3D, rotation: Option[Vector3D], radius: Option[Float],
                                    viewport: Option[Int], resolution: Option[Int], bitDepth: Option[Int],
                                    interpolation: Option[Boolean], treeId: Int, timestamp: Long) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper with ProtoGeometryImplicits {
  override def applyOn(tracing: SkeletonTracing) = {
    val rotationOrDefault = rotation getOrElse NodeDefaults.rotation
    val newNode = Node(
      id,
      position,
      rotationOrDefault,
      radius getOrElse NodeDefaults.radius,
      viewport getOrElse NodeDefaults.viewport,
      resolution getOrElse NodeDefaults.resolution,
      bitDepth getOrElse NodeDefaults.bitDepth,
      interpolation getOrElse NodeDefaults.interpolation,
      createdTimestamp = timestamp
    )

    def treeTransform(tree: Tree) = tree.withNodes(newNode +: tree.nodes)

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }
}


case class UpdateNodeSkeletonAction(id: Int, position: Point3D, rotation: Option[Vector3D], radius: Option[Float],
                                    viewport: Option[Int], resolution: Option[Int], bitDepth: Option[Int],
                                    interpolation: Option[Boolean], treeId: Int, timestamp: Long) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper with ProtoGeometryImplicits {
  override def applyOn(tracing: SkeletonTracing) = {

    val rotationOrDefault = rotation getOrElse NodeDefaults.rotation
    val newNode = Node(
      id,
      position,
      rotationOrDefault,
      radius getOrElse NodeDefaults.radius,
      viewport getOrElse NodeDefaults.viewport,
      resolution getOrElse NodeDefaults.resolution,
      bitDepth getOrElse NodeDefaults.bitDepth,
      interpolation getOrElse NodeDefaults.interpolation,
      createdTimestamp = timestamp
    )

    def treeTransform(tree: Tree) =
      tree.withNodes(tree.nodes.map(n => if (n.id == newNode.id) newNode else n))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }
}

case class DeleteNodeSkeletonAction(nodeId: Int, treeId: Int) extends UpdateAction.SkeletonUpdateAction with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {

    def treeTransform(tree: Tree) =
      tree
        .withNodes(tree.nodes.filter(_.id != nodeId))
        .withEdges(tree.edges.filter(e => e.source != nodeId && e.target != nodeId))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }
}

case class UpdateTracingSkeletonAction(activeNode: Option[Int], editPosition: com.scalableminds.util.geometry.Point3D,
                                       editRotation: com.scalableminds.util.geometry.Vector3D, zoomLevel: Double,
                                       userBoundingBox: Option[com.scalableminds.util.geometry.BoundingBox]) extends UpdateAction.SkeletonUpdateAction with ProtoGeometryImplicits {
  override def applyOn(tracing: SkeletonTracing) =
    tracing
      .withEditPosition(editPosition)
      .withEditRotation(editRotation)
      .withZoomLevel(zoomLevel)
      .copy(userBoundingBox = userBoundingBox, activeNodeId = activeNode)
}



case class RevertToVersionAction(sourceVersion: Long) extends UpdateAction.SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = throw new Exception("RevertToVersionAction applied on unversioned tracing")
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
object RevertToVersionAction {implicit val jsonFormat = Json.format[RevertToVersionAction]}



object SkeletonUpdateAction {

  implicit object skeletonUpdateActionFormat extends Format[UpdateAction[SkeletonTracing]] {
    override def reads(json: JsValue): JsResult[UpdateAction.SkeletonUpdateAction] = {
      val jsonValue = (json \ "value").as[JsObject]
      (json \ "name").as[String] match {
        case "createTree" => deserialize[CreateTreeSkeletonAction](jsonValue)
        case "deleteTree" => deserialize[DeleteTreeSkeletonAction](jsonValue)
        case "updateTree" => deserialize[UpdateTreeSkeletonAction](jsonValue)
        case "mergeTree" => deserialize[MergeTreeSkeletonAction](jsonValue)
        case "moveTreeComponent" => deserialize[MoveTreeComponentSkeletonAction](jsonValue)
        case "createNode" => deserialize[CreateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
        case "deleteNode" => deserialize[DeleteNodeSkeletonAction](jsonValue)
        case "updateNode" => deserialize[UpdateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
        case "createEdge" => deserialize[CreateEdgeSkeletonAction](jsonValue)
        case "deleteEdge" => deserialize[DeleteEdgeSkeletonAction](jsonValue)
        case "updateTracing" => deserialize[UpdateTracingSkeletonAction](jsonValue)
        case "revertToVersion" => deserialize[RevertToVersionAction](jsonValue)
      }
    }

    def deserialize[T](json: JsValue, shouldTransformPositions: Boolean = false)(implicit tjs: Reads[T]) = {
      if (shouldTransformPositions)
        json.transform(positionTransform).get.validate[T]
      else
        json.validate[T]
    }

    private val positionTransform = (JsPath \ 'position).json.update(
      JsPath.read[List[Float]].map(position => Json.toJson(position.map(_.toInt))))

    override def writes(a: UpdateAction[SkeletonTracing]) = a match{
      case s: CreateTreeSkeletonAction => Json.obj("name" -> "createTree", "value" -> Json.toJson(s)(CreateTreeSkeletonAction.jsonFormat))
      case s: DeleteTreeSkeletonAction => Json.obj("name" -> "deleteTree", "value" -> Json.toJson(s)(DeleteTreeSkeletonAction.jsonFormat))
      case s: UpdateTreeSkeletonAction => Json.obj("name" -> "updateTree", "value" -> Json.toJson(s)(UpdateTreeSkeletonAction.jsonFormat))
      case s: MergeTreeSkeletonAction => Json.obj("name" -> "mergeTree", "value" -> Json.toJson(s)(MergeTreeSkeletonAction.jsonFormat))
      case s: MoveTreeComponentSkeletonAction => Json.obj("name" -> "moveTreeComponent", "value" -> Json.toJson(s)(MoveTreeComponentSkeletonAction.jsonFormat))
      case s: CreateNodeSkeletonAction => Json.obj("name" -> "createNode", "value" -> Json.toJson(s)(CreateNodeSkeletonAction.jsonFormat))
      case s: DeleteNodeSkeletonAction => Json.obj("name" -> "deleteNode", "value" -> Json.toJson(s)(DeleteNodeSkeletonAction.jsonFormat))
      case s: UpdateNodeSkeletonAction => Json.obj("name" -> "updateNode", "value" -> Json.toJson(s)(UpdateNodeSkeletonAction.jsonFormat))
      case s: CreateEdgeSkeletonAction => Json.obj("name" -> "createEdge", "value" -> Json.toJson(s)(CreateEdgeSkeletonAction.jsonFormat))
      case s: DeleteEdgeSkeletonAction => Json.obj("name" -> "deleteEdge", "value" -> Json.toJson(s)(DeleteEdgeSkeletonAction.jsonFormat))
      case s: UpdateTracingSkeletonAction => Json.obj("name" -> "updateTracing", "value" -> Json.toJson(s)(UpdateTracingSkeletonAction.jsonFormat))
      case s: RevertToVersionAction => Json.obj("name" -> "revertToVersion", "value" -> Json.toJson(s)(RevertToVersionAction.jsonFormat))
    }
  }
}
