package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.webknossos.tracingstore.SkeletonTracing._
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.skeleton._
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import play.api.libs.json._

case class CreateTreeSkeletonAction(id: Int,
                                    color: Option[com.scalableminds.util.image.Color],
                                    name: String,
                                    branchPoints: List[UpdateActionBranchPoint],
                                    timestamp: Long,
                                    comments: List[UpdateActionComment],
                                    groupId: Option[Int],
                                    isVisible: Option[Boolean],
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    val newTree = Tree(id,
                       Nil,
                       Nil,
                       convertColorOpt(color),
                       branchPoints.map(convertBranchPoint),
                       comments.map(convertComment),
                       name,
                       timestamp,
                       groupId,
                       isVisible)
    tracing.withTrees(newTree +: tracing.trees)
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class DeleteTreeSkeletonAction(id: Int, actionTimestamp: Option[Long] = None, info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = tracing.withTrees(tracing.trees.filter(_.treeId != id))

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateTreeSkeletonAction(id: Int,
                                    updatedId: Option[Int],
                                    color: Option[com.scalableminds.util.image.Color],
                                    name: String,
                                    branchPoints: List[UpdateActionBranchPoint],
                                    comments: List[UpdateActionComment],
                                    groupId: Option[Int],
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(tree: Tree) =
      tree.copy(
        color = if (color.isDefined) convertColorOpt(color) else tree.color,
        treeId = updatedId.getOrElse(tree.treeId),
        branchPoints = branchPoints.map(convertBranchPoint),
        comments = comments.map(convertComment),
        name = name,
        groupId = groupId,
      )

    tracing.withTrees(mapTrees(tracing, id, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class MergeTreeSkeletonAction(sourceId: Int,
                                   targetId: Int,
                                   actionTimestamp: Option[Long] = None,
                                   info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  // only nodes and edges are merged here,
  // other properties are managed explicitly
  // by the frontend with extra actions
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(targetTree: Tree) = {
      val sourceTree = treeById(tracing, sourceId)
      targetTree.withNodes(targetTree.nodes.union(sourceTree.nodes)).withEdges(targetTree.edges.union(sourceTree.edges))
    }

    tracing.withTrees(mapTrees(tracing, targetId, treeTransform).filter(_.treeId != sourceId))
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class MoveTreeComponentSkeletonAction(nodeIds: List[Int],
                                           sourceId: Int,
                                           targetId: Int,
                                           actionTimestamp: Option[Long] = None,
                                           info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  // this should only move a whole component,
  // that is disjoint from the rest of the tree
  override def applyOn(tracing: SkeletonTracing) = {
    val sourceTree = treeById(tracing, sourceId)
    val targetTree = treeById(tracing, targetId)

    val (movedNodes, remainingNodes) = sourceTree.nodes.partition(nodeIds contains _.id)
    val (movedEdges, remainingEdges) =
      sourceTree.edges.partition(e => nodeIds.contains(e.source) && nodeIds.contains(e.target))
    val updatedSource = sourceTree.copy(nodes = remainingNodes, edges = remainingEdges)
    val updatedTarget =
      targetTree.copy(nodes = targetTree.nodes.union(movedNodes), edges = targetTree.edges.union(movedEdges))

    def selectTree(tree: Tree) =
      if (tree.treeId == sourceId)
        updatedSource
      else if (tree.treeId == targetId)
        updatedTarget
      else tree

    tracing.withTrees(tracing.trees.map(selectTree))
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class CreateEdgeSkeletonAction(source: Int,
                                    target: Int,
                                    treeId: Int,
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(tree: Tree) = tree.withEdges(Edge(source, target) +: tree.edges)
    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class DeleteEdgeSkeletonAction(source: Int,
                                    target: Int,
                                    treeId: Int,
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(tree: Tree) = tree.copy(edges = tree.edges.filter(_ != Edge(source, target)))
    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class CreateNodeSkeletonAction(id: Int,
                                    position: Point3D,
                                    rotation: Option[Vector3D],
                                    radius: Option[Float],
                                    viewport: Option[Int],
                                    resolution: Option[Int],
                                    bitDepth: Option[Int],
                                    interpolation: Option[Boolean],
                                    treeId: Int,
                                    timestamp: Long,
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper
    with ProtoGeometryImplicits {
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

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateNodeSkeletonAction(id: Int,
                                    position: Point3D,
                                    rotation: Option[Vector3D],
                                    radius: Option[Float],
                                    viewport: Option[Int],
                                    resolution: Option[Int],
                                    bitDepth: Option[Int],
                                    interpolation: Option[Boolean],
                                    treeId: Int,
                                    timestamp: Long,
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper
    with ProtoGeometryImplicits {
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

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)

}

case class DeleteNodeSkeletonAction(nodeId: Int,
                                    treeId: Int,
                                    actionTimestamp: Option[Long] = None,
                                    info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {

    def treeTransform(tree: Tree) =
      tree.withNodes(tree.nodes.filter(_.id != nodeId))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateTreeGroupsSkeletonAction(treeGroups: List[UpdateActionTreeGroup],
                                          actionTimestamp: Option[Long] = None,
                                          info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) =
    tracing.withTreeGroups(treeGroups.map(convertTreeGroup))

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateTracingSkeletonAction(activeNode: Option[Int],
                                       editPosition: com.scalableminds.util.geometry.Point3D,
                                       editRotation: com.scalableminds.util.geometry.Vector3D,
                                       zoomLevel: Double,
                                       userBoundingBox: Option[com.scalableminds.util.geometry.BoundingBox],
                                       actionTimestamp: Option[Long] = None,
                                       info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with ProtoGeometryImplicits {
  override def applyOn(tracing: SkeletonTracing) =
    tracing.copy(editPosition = editPosition,
                 editRotation = editRotation,
                 zoomLevel = zoomLevel,
                 userBoundingBox = userBoundingBox,
                 activeNodeId = activeNode)

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class RevertToVersionAction(sourceVersion: Long, actionTimestamp: Option[Long] = None, info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) =
    throw new Exception("RevertToVersionAction applied on unversioned tracing")

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateTreeVisibility(treeId: Int,
                                isVisible: Boolean,
                                actionTimestamp: Option[Long] = None,
                                info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def treeTransform(tree: Tree) = tree.copy(isVisible = Some(isVisible))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateTreeGroupVisibility(treeGroupId: Option[Int],
                                     isVisible: Boolean,
                                     actionTimestamp: Option[Long] = None,
                                     info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing) = {
    def updateTreeGroups(treeGroups: Seq[TreeGroup]) = {
      def treeTransform(tree: Tree) =
        if (treeGroups.exists(group => tree.groupId.contains(group.groupId)))
          tree.copy(isVisible = Some(isVisible))
        else tree

      tracing.withTrees(mapAllTrees(tracing, treeTransform))
    }

    def allTreeTransform(tree: Tree) = tree.copy(isVisible = Some(isVisible))

    treeGroupId match {
      case None => tracing.withTrees(mapAllTrees(tracing, allTreeTransform))
      case Some(groupId) =>
        tracing.treeGroups
          .find(_.groupId == groupId)
          .map(group => updateTreeGroups(TreeUtils.getAllChildrenGroups(group)))
          .getOrElse(tracing)
    }
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateUserBoundingBoxes(boundingBoxes: List[NamedBoundingBox],
                                   actionTimestamp: Option[Long] = None,
                                   info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) =
    tracing.withUserBoundingBoxes(boundingBoxes.map(_.toProto))

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateUserBoundingBoxVisibility(boundingBoxId: Option[Int],
                                           isVisible: Boolean,
                                           actionTimestamp: Option[Long] = None,
                                           info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing) = {
    def updateUserBoundingBoxes() =
      tracing.userBoundingBoxes.map { boundingBox =>
        if (boundingBoxId.forall(_ == boundingBox.id))
          boundingBox.copy(isVisible = Some(isVisible))
        else
          boundingBox
      }

    tracing.withUserBoundingBoxes(updateUserBoundingBoxes())
  }

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

case class UpdateTdCamera(actionTimestamp: Option[Long] = None, info: Option[String] = None)
    extends UpdateAction.SkeletonUpdateAction {

  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = tracing

  override def addTimestamp(timestamp: Long): UpdateAction[SkeletonTracing] =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction[SkeletonTracing] = this.copy(info = info)
}

object CreateTreeSkeletonAction { implicit val jsonFormat = Json.format[CreateTreeSkeletonAction] }
object DeleteTreeSkeletonAction { implicit val jsonFormat = Json.format[DeleteTreeSkeletonAction] }
object UpdateTreeSkeletonAction { implicit val jsonFormat = Json.format[UpdateTreeSkeletonAction] }
object MergeTreeSkeletonAction { implicit val jsonFormat = Json.format[MergeTreeSkeletonAction] }
object MoveTreeComponentSkeletonAction { implicit val jsonFormat = Json.format[MoveTreeComponentSkeletonAction] }
object CreateEdgeSkeletonAction { implicit val jsonFormat = Json.format[CreateEdgeSkeletonAction] }
object DeleteEdgeSkeletonAction { implicit val jsonFormat = Json.format[DeleteEdgeSkeletonAction] }
object CreateNodeSkeletonAction { implicit val jsonFormat = Json.format[CreateNodeSkeletonAction] }
object DeleteNodeSkeletonAction { implicit val jsonFormat = Json.format[DeleteNodeSkeletonAction] }
object UpdateNodeSkeletonAction { implicit val jsonFormat = Json.format[UpdateNodeSkeletonAction] }
object UpdateTreeGroupsSkeletonAction { implicit val jsonFormat = Json.format[UpdateTreeGroupsSkeletonAction] }
object UpdateTracingSkeletonAction { implicit val jsonFormat = Json.format[UpdateTracingSkeletonAction] }
object RevertToVersionAction { implicit val jsonFormat = Json.format[RevertToVersionAction] }
object UpdateTreeVisibility { implicit val jsonFormat = Json.format[UpdateTreeVisibility] }
object UpdateTreeGroupVisibility { implicit val jsonFormat = Json.format[UpdateTreeGroupVisibility] }
object UpdateUserBoundingBoxes { implicit val jsonFormat = Json.format[UpdateUserBoundingBoxes] }
object UpdateUserBoundingBoxVisibility { implicit val jsonFormat = Json.format[UpdateUserBoundingBoxVisibility] }
object UpdateTdCamera { implicit val jsonFormat = Json.format[UpdateTdCamera] }

object SkeletonUpdateAction {

  implicit object skeletonUpdateActionFormat extends Format[UpdateAction[SkeletonTracing]] {
    override def reads(json: JsValue): JsResult[UpdateAction.SkeletonUpdateAction] = {
      val jsonValue = (json \ "value").as[JsObject]
      (json \ "name").as[String] match {
        case "createTree"                      => deserialize[CreateTreeSkeletonAction](jsonValue)
        case "deleteTree"                      => deserialize[DeleteTreeSkeletonAction](jsonValue)
        case "updateTree"                      => deserialize[UpdateTreeSkeletonAction](jsonValue)
        case "mergeTree"                       => deserialize[MergeTreeSkeletonAction](jsonValue)
        case "moveTreeComponent"               => deserialize[MoveTreeComponentSkeletonAction](jsonValue)
        case "createNode"                      => deserialize[CreateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
        case "deleteNode"                      => deserialize[DeleteNodeSkeletonAction](jsonValue)
        case "updateNode"                      => deserialize[UpdateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
        case "createEdge"                      => deserialize[CreateEdgeSkeletonAction](jsonValue)
        case "deleteEdge"                      => deserialize[DeleteEdgeSkeletonAction](jsonValue)
        case "updateTreeGroups"                => deserialize[UpdateTreeGroupsSkeletonAction](jsonValue)
        case "updateTracing"                   => deserialize[UpdateTracingSkeletonAction](jsonValue)
        case "revertToVersion"                 => deserialize[RevertToVersionAction](jsonValue)
        case "updateTreeVisibility"            => deserialize[UpdateTreeVisibility](jsonValue)
        case "updateTreeGroupVisibility"       => deserialize[UpdateTreeGroupVisibility](jsonValue)
        case "updateUserBoundingBoxes"         => deserialize[UpdateUserBoundingBoxes](jsonValue)
        case "updateUserBoundingBoxVisibility" => deserialize[UpdateUserBoundingBoxVisibility](jsonValue)
        case "updateTdCamera"                  => deserialize[UpdateTdCamera](jsonValue)
      }
    }

    def deserialize[T](json: JsValue, shouldTransformPositions: Boolean = false)(implicit tjs: Reads[T]): JsResult[T] =
      if (shouldTransformPositions)
        json.transform(positionTransform).get.validate[T]
      else
        json.validate[T]

    private val positionTransform =
      (JsPath \ 'position).json.update(JsPath.read[List[Float]].map(position => Json.toJson(position.map(_.toInt))))

    override def writes(a: UpdateAction[SkeletonTracing]): JsObject = a match {
      case s: CreateTreeSkeletonAction =>
        Json.obj("name" -> "createTree", "value" -> Json.toJson(s)(CreateTreeSkeletonAction.jsonFormat))
      case s: DeleteTreeSkeletonAction =>
        Json.obj("name" -> "deleteTree", "value" -> Json.toJson(s)(DeleteTreeSkeletonAction.jsonFormat))
      case s: UpdateTreeSkeletonAction =>
        Json.obj("name" -> "updateTree", "value" -> Json.toJson(s)(UpdateTreeSkeletonAction.jsonFormat))
      case s: MergeTreeSkeletonAction =>
        Json.obj("name" -> "mergeTree", "value" -> Json.toJson(s)(MergeTreeSkeletonAction.jsonFormat))
      case s: MoveTreeComponentSkeletonAction =>
        Json.obj("name" -> "moveTreeComponent", "value" -> Json.toJson(s)(MoveTreeComponentSkeletonAction.jsonFormat))
      case s: CreateNodeSkeletonAction =>
        Json.obj("name" -> "createNode", "value" -> Json.toJson(s)(CreateNodeSkeletonAction.jsonFormat))
      case s: DeleteNodeSkeletonAction =>
        Json.obj("name" -> "deleteNode", "value" -> Json.toJson(s)(DeleteNodeSkeletonAction.jsonFormat))
      case s: UpdateNodeSkeletonAction =>
        Json.obj("name" -> "updateNode", "value" -> Json.toJson(s)(UpdateNodeSkeletonAction.jsonFormat))
      case s: CreateEdgeSkeletonAction =>
        Json.obj("name" -> "createEdge", "value" -> Json.toJson(s)(CreateEdgeSkeletonAction.jsonFormat))
      case s: DeleteEdgeSkeletonAction =>
        Json.obj("name" -> "deleteEdge", "value" -> Json.toJson(s)(DeleteEdgeSkeletonAction.jsonFormat))
      case s: UpdateTreeGroupsSkeletonAction =>
        Json.obj("name" -> "updateTreeGroups", "value" -> Json.toJson(s)(UpdateTreeGroupsSkeletonAction.jsonFormat))
      case s: UpdateTracingSkeletonAction =>
        Json.obj("name" -> "updateTracing", "value" -> Json.toJson(s)(UpdateTracingSkeletonAction.jsonFormat))
      case s: RevertToVersionAction =>
        Json.obj("name" -> "revertToVersion", "value" -> Json.toJson(s)(RevertToVersionAction.jsonFormat))
      case s: UpdateTreeVisibility =>
        Json.obj("name" -> "updateTreeVisibility", "value" -> Json.toJson(s)(UpdateTreeVisibility.jsonFormat))
      case s: UpdateTreeGroupVisibility =>
        Json.obj("name" -> "updateTreeGroupVisibility", "value" -> Json.toJson(s)(UpdateTreeGroupVisibility.jsonFormat))
      case s: UpdateUserBoundingBoxes =>
        Json.obj("name" -> "updateUserBoundingBoxes", "value" -> Json.toJson(s)(UpdateUserBoundingBoxes.jsonFormat))
      case s: UpdateUserBoundingBoxVisibility =>
        Json.obj("name" -> "updateUserBoundingBoxVisibility",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxVisibility.jsonFormat))
      case s: UpdateTdCamera =>
        Json.obj("name" -> "updateTdCamera", "value" -> Json.toJson(s)(UpdateTdCamera.jsonFormat))
    }
  }
}
