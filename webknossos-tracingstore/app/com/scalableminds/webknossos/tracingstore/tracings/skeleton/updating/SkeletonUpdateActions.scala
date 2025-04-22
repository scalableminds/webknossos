package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.SkeletonTracing.{
  Edge,
  Node,
  SkeletonTracing,
  SkeletonUserStateProto,
  Tree,
  TreeGroup
}
import com.scalableminds.webknossos.datastore.helpers.{NodeDefaults, ProtoGeometryImplicits}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.tracingstore.annotation.{LayerUpdateAction, UpdateAction, UserStateUpdateAction}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.TreeType.TreeType
import play.api.libs.json._

trait SkeletonUpdateAction extends LayerUpdateAction {
  def applyOn(tracing: SkeletonTracing): SkeletonTracing

  def updatedTreeBodyIds: Set[Int] = Set.empty
}

case class CreateTreeSkeletonAction(id: Int,
                                    color: Option[com.scalableminds.util.image.Color],
                                    name: String,
                                    branchPoints: List[UpdateActionBranchPoint],
                                    timestamp: Long,
                                    comments: List[UpdateActionComment],
                                    groupId: Option[Int],
                                    isVisible: Option[Boolean],
                                    `type`: Option[TreeType] = None,
                                    edgesAreVisible: Option[Boolean],
                                    metadata: Option[Seq[MetadataEntry]] = None,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    val newTree = Tree(
      id,
      Nil,
      Nil,
      colorOptToProto(color),
      branchPoints.map(convertBranchPoint),
      comments.map(convertComment),
      name,
      timestamp,
      groupId,
      isVisible,
      `type`.map(TreeType.toProto),
      edgesAreVisible,
      metadata = MetadataEntry.toProtoMultiple(MetadataEntry.deduplicate(metadata))
    )
    tracing.withTrees(newTree +: tracing.trees)
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(id)
}

case class DeleteTreeSkeletonAction(id: Int,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing =
    tracing.withTrees(tracing.trees.filter(_.treeId != id))

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(id)
}

case class UpdateTreeSkeletonAction(id: Int,
                                    updatedId: Option[Int],
                                    color: Option[com.scalableminds.util.image.Color],
                                    name: String,
                                    branchPoints: List[UpdateActionBranchPoint],
                                    comments: List[UpdateActionComment],
                                    groupId: Option[Int],
                                    `type`: Option[TreeType] = None,
                                    metadata: Option[Seq[MetadataEntry]] = None,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    def treeTransform(tree: Tree) =
      tree.copy(
        color = colorOptToProto(color).orElse(tree.color),
        treeId = updatedId.getOrElse(tree.treeId),
        branchPoints = branchPoints.map(convertBranchPoint),
        comments = comments.map(convertComment),
        name = name,
        groupId = groupId,
        `type` = `type`.map(TreeType.toProto),
        metadata = MetadataEntry.toProtoMultiple(MetadataEntry.deduplicate(metadata))
      )

    tracing.withTrees(mapTrees(tracing, id, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class MergeTreeSkeletonAction(sourceId: Int,
                                   targetId: Int,
                                   actionTracingId: String,
                                   actionTimestamp: Option[Long] = None,
                                   actionAuthorId: Option[String] = None,
                                   info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {

  // only nodes and edges are merged here,
  // other properties are managed explicitly
  // by the frontend with extra actions
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    def treeTransform(targetTree: Tree) = {
      val sourceTree = treeById(tracing, sourceId)
      targetTree
        .withNodes(targetTree.nodes.concat(sourceTree.nodes))
        .withEdges(targetTree.edges.concat(sourceTree.edges))
    }

    tracing.withTrees(mapTrees(tracing, targetId, treeTransform).filter(_.treeId != sourceId))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(sourceId, targetId)
}

case class MoveTreeComponentSkeletonAction(nodeIds: List[Int],
                                           sourceId: Int,
                                           targetId: Int,
                                           actionTracingId: String,
                                           actionTimestamp: Option[Long] = None,
                                           actionAuthorId: Option[String] = None,
                                           info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {

  // this should only move a whole component,
  // that is disjoint from the rest of the tree
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    val sourceTree = treeById(tracing, sourceId)
    val targetTree = treeById(tracing, targetId)

    val (movedNodes, remainingNodes) = sourceTree.nodes.partition(nodeIds contains _.id)
    val (movedEdges, remainingEdges) =
      sourceTree.edges.partition(e => nodeIds.contains(e.source) && nodeIds.contains(e.target))
    val updatedSource = sourceTree.copy(nodes = remainingNodes, edges = remainingEdges)
    val updatedTarget =
      targetTree.copy(nodes = targetTree.nodes.concat(movedNodes), edges = targetTree.edges.concat(movedEdges))

    def selectTree(tree: Tree) =
      if (tree.treeId == sourceId)
        updatedSource
      else if (tree.treeId == targetId)
        updatedTarget
      else tree

    tracing.withTrees(tracing.trees.map(selectTree))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(sourceId, targetId)
}

case class CreateEdgeSkeletonAction(source: Int,
                                    target: Int,
                                    treeId: Int,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    def treeTransform(tree: Tree) = tree.withEdges(Edge(source, target) +: tree.edges)
    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(treeId)
}

case class DeleteEdgeSkeletonAction(source: Int,
                                    target: Int,
                                    treeId: Int,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    def treeTransform(tree: Tree) = tree.copy(edges = tree.edges.filter(_ != Edge(source, target)))
    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(treeId)
}

case class CreateNodeSkeletonAction(id: Int,
                                    position: Vec3Int,
                                    rotation: Option[Vec3Double],
                                    radius: Option[Float],
                                    viewport: Option[Int],
                                    resolution: Option[Int],
                                    bitDepth: Option[Int],
                                    interpolation: Option[Boolean],
                                    treeId: Int,
                                    timestamp: Long,
                                    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper
    with ProtoGeometryImplicits {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    val rotationOrDefault = rotation getOrElse NodeDefaults.rotation
    val newNode = Node(
      id,
      position,
      rotationOrDefault,
      radius getOrElse NodeDefaults.radius,
      viewport getOrElse NodeDefaults.viewport,
      resolution getOrElse NodeDefaults.mag,
      bitDepth getOrElse NodeDefaults.bitDepth,
      interpolation getOrElse NodeDefaults.interpolation,
      createdTimestamp = timestamp,
      additionalCoordinates = AdditionalCoordinate.toProto(additionalCoordinates)
    )

    def treeTransform(tree: Tree) = tree.withNodes(newNode +: tree.nodes)

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(treeId)
}

case class UpdateNodeSkeletonAction(id: Int,
                                    position: Vec3Int,
                                    rotation: Option[Vec3Double],
                                    radius: Option[Float],
                                    viewport: Option[Int],
                                    resolution: Option[Int],
                                    bitDepth: Option[Int],
                                    interpolation: Option[Boolean],
                                    treeId: Int,
                                    timestamp: Long,
                                    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper
    with ProtoGeometryImplicits {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {

    val rotationOrDefault = rotation getOrElse NodeDefaults.rotation
    val newNode = Node(
      id,
      position,
      rotationOrDefault,
      radius getOrElse NodeDefaults.radius,
      viewport getOrElse NodeDefaults.viewport,
      resolution getOrElse NodeDefaults.mag,
      bitDepth getOrElse NodeDefaults.bitDepth,
      interpolation getOrElse NodeDefaults.interpolation,
      createdTimestamp = timestamp,
      additionalCoordinates = AdditionalCoordinate.toProto(additionalCoordinates)
    )

    def treeTransform(tree: Tree) =
      tree.withNodes(tree.nodes.map(n => if (n.id == newNode.id) newNode else n))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(treeId)
}

case class DeleteNodeSkeletonAction(nodeId: Int,
                                    treeId: Int,
                                    actionTracingId: String,
                                    actionTimestamp: Option[Long] = None,
                                    actionAuthorId: Option[String] = None,
                                    info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {

    def treeTransform(tree: Tree) =
      tree.withNodes(tree.nodes.filter(_.id != nodeId))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def updatedTreeBodyIds: Set[Int] = Set(treeId)
}

case class UpdateTreeGroupsSkeletonAction(treeGroups: List[UpdateActionTreeGroup],
                                          actionTracingId: String,
                                          actionTimestamp: Option[Long] = None,
                                          actionAuthorId: Option[String] = None,
                                          info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing =
    tracing.withTreeGroups(treeGroups.map(convertTreeGroup))

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateTreeGroupsExpandedStateSkeletonAction(groupIds: List[Int],
                                                       areExpanded: Boolean,
                                                       actionTracingId: String,
                                                       actionTimestamp: Option[Long] = None,
                                                       actionAuthorId: Option[String] = None,
                                                       info: Option[String] = None)
    extends SkeletonUpdateAction
    with UserStateUpdateAction {
  override def addTimestamp(timestamp: Long): SkeletonUpdateAction = this.copy(actionTimestamp = Some(timestamp))

  override def addAuthorId(authorId: Option[String]): SkeletonUpdateAction =
    this.copy(actionAuthorId = authorId)

  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  // TODO apply in user state
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = actionAuthorId match {
    case None => tracing
    case Some(actionUserId) => // TODO extract to trait, implement applyOnUserState
      val userStateAlreadyPresent = tracing.userState.exists(state => actionUserId == state.userId)
      if (userStateAlreadyPresent) {
        tracing.copy(userState = tracing.userState.map {
          case userState if actionUserId == userState.userId =>
            userState.copy(
              userId = actionUserId,
              treeGroupIds = List(1, 2, 3),
              treeGroupVisibilities = List(true, true, true)
            )
          case userState => userState
        })
      } else {
        tracing.copy(
          userState = tracing.userState :+ SkeletonUserStateProto(
            userId = actionUserId,
            treeGroupIds = List(1, 2, 3),
            treeGroupVisibilities = List(true, true, true),
            boundingBoxIds = Seq.empty,
            boundingBoxVisibilities = Seq.empty,
            treeIds = Seq.empty,
            treeVisibilities = Seq.empty // TODO other properties from tracing legacy state?
          ))
      }
  }
}

case class UpdateTracingSkeletonAction(activeNode: Option[Int],
                                       editPosition: com.scalableminds.util.geometry.Vec3Int,
                                       editRotation: com.scalableminds.util.geometry.Vec3Double,
                                       zoomLevel: Double,
                                       userBoundingBox: Option[com.scalableminds.util.geometry.BoundingBox],
                                       actionTracingId: String,
                                       actionTimestamp: Option[Long] = None,
                                       actionAuthorId: Option[String] = None,
                                       info: Option[String] = None,
                                       editPositionAdditionalCoordinates: Option[Seq[AdditionalCoordinate]] = None)
    extends SkeletonUpdateAction
    with ProtoGeometryImplicits {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing =
    tracing.copy(
      editPosition = editPosition,
      editRotation = editRotation,
      zoomLevel = zoomLevel,
      userBoundingBox = userBoundingBox,
      activeNodeId = activeNode,
      editPositionAdditionalCoordinates = AdditionalCoordinate.toProto(editPositionAdditionalCoordinates)
    )

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true
}

case class UpdateUserStateSkeletonAction(activeNode: Option[Int],
                                         actionTracingId: String,
                                         actionTimestamp: Option[Long] = None,
                                         actionAuthorId: Option[String] = None,
                                         info: Option[String] = None)
    extends SkeletonUpdateAction
    with UserStateUpdateAction {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing =
    tracing.copy(
      activeNodeId = activeNode
    )

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))

  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)

  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)

  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true
}

case class UpdateTreeVisibilitySkeletonAction(treeId: Int,
                                              isVisible: Boolean,
                                              actionTracingId: String,
                                              actionTimestamp: Option[Long] = None,
                                              actionAuthorId: Option[String] = None,
                                              info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    def treeTransform(tree: Tree) = tree.copy(isVisible = Some(isVisible))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true
}

case class UpdateTreeGroupVisibilitySkeletonAction(treeGroupId: Option[Int],
                                                   isVisible: Boolean,
                                                   actionTracingId: String,
                                                   actionTimestamp: Option[Long] = None,
                                                   actionAuthorId: Option[String] = None,
                                                   info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
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
          .map(group => updateTreeGroups(GroupUtils.getAllChildrenTreeGroups(group)))
          .getOrElse(tracing)
    }
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true
}

case class UpdateTreeEdgesVisibilitySkeletonAction(treeId: Int,
                                                   edgesAreVisible: Boolean,
                                                   actionTracingId: String,
                                                   actionTimestamp: Option[Long] = None,
                                                   actionAuthorId: Option[String] = None,
                                                   info: Option[String] = None)
    extends SkeletonUpdateAction
    with SkeletonUpdateActionHelper {

  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    def treeTransform(tree: Tree) = tree.copy(edgesAreVisible = Some(edgesAreVisible))

    tracing.withTrees(mapTrees(tracing, treeId, treeTransform))
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true
}

case class UpdateUserBoundingBoxesSkeletonAction(boundingBoxes: List[NamedBoundingBox],
                                                 actionTracingId: String,
                                                 actionTimestamp: Option[Long] = None,
                                                 actionAuthorId: Option[String] = None,
                                                 info: Option[String] = None)
    extends SkeletonUpdateAction {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing =
    tracing.withUserBoundingBoxes(boundingBoxes.map(_.toProto))

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

case class UpdateUserBoundingBoxVisibilitySkeletonAction(boundingBoxId: Option[Int],
                                                         isVisible: Boolean,
                                                         actionTracingId: String,
                                                         actionTimestamp: Option[Long] = None,
                                                         actionAuthorId: Option[String] = None,
                                                         info: Option[String] = None)
    extends SkeletonUpdateAction
    with UserStateUpdateAction {
  override def applyOn(tracing: SkeletonTracing): SkeletonTracing = {
    def updateUserBoundingBoxes() =
      tracing.userBoundingBoxes.map { boundingBox =>
        if (boundingBoxId.forall(_ == boundingBox.id))
          boundingBox.copy(isVisible = Some(isVisible))
        else
          boundingBox
      }

    tracing.withUserBoundingBoxes(updateUserBoundingBoxes())
  }

  override def addTimestamp(timestamp: Long): UpdateAction =
    this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[String]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): LayerUpdateAction =
    this.copy(actionTracingId = newTracingId)

  override def isViewOnlyChange: Boolean = true
}

object CreateTreeSkeletonAction {
  implicit val jsonFormat: OFormat[CreateTreeSkeletonAction] = Json.format[CreateTreeSkeletonAction]
}
object DeleteTreeSkeletonAction {
  implicit val jsonFormat: OFormat[DeleteTreeSkeletonAction] = Json.format[DeleteTreeSkeletonAction]
}
object UpdateTreeSkeletonAction {
  implicit val jsonFormat: OFormat[UpdateTreeSkeletonAction] = Json.format[UpdateTreeSkeletonAction]
}
object MergeTreeSkeletonAction {
  implicit val jsonFormat: OFormat[MergeTreeSkeletonAction] = Json.format[MergeTreeSkeletonAction]
}
object MoveTreeComponentSkeletonAction {
  implicit val jsonFormat: OFormat[MoveTreeComponentSkeletonAction] = Json.format[MoveTreeComponentSkeletonAction]
}
object CreateEdgeSkeletonAction {
  implicit val jsonFormat: OFormat[CreateEdgeSkeletonAction] = Json.format[CreateEdgeSkeletonAction]
}
object DeleteEdgeSkeletonAction {
  implicit val jsonFormat: OFormat[DeleteEdgeSkeletonAction] = Json.format[DeleteEdgeSkeletonAction]
}
object CreateNodeSkeletonAction {
  implicit val jsonFormat: OFormat[CreateNodeSkeletonAction] = Json.format[CreateNodeSkeletonAction]
}
object DeleteNodeSkeletonAction {
  implicit val jsonFormat: OFormat[DeleteNodeSkeletonAction] = Json.format[DeleteNodeSkeletonAction]
}
object UpdateNodeSkeletonAction {
  implicit val jsonFormat: OFormat[UpdateNodeSkeletonAction] = Json.format[UpdateNodeSkeletonAction]
}
object UpdateTreeGroupsSkeletonAction {
  implicit val jsonFormat: OFormat[UpdateTreeGroupsSkeletonAction] = Json.format[UpdateTreeGroupsSkeletonAction]
}
object UpdateTracingSkeletonAction {
  implicit val jsonFormat: OFormat[UpdateTracingSkeletonAction] = Json.format[UpdateTracingSkeletonAction]
}
object UpdateUserStateSkeletonAction {
  implicit val jsonFormat: OFormat[UpdateUserStateSkeletonAction] = Json.format[UpdateUserStateSkeletonAction]
}
object UpdateTreeVisibilitySkeletonAction {
  implicit val jsonFormat: OFormat[UpdateTreeVisibilitySkeletonAction] = Json.format[UpdateTreeVisibilitySkeletonAction]
}
object UpdateTreeGroupVisibilitySkeletonAction {
  implicit val jsonFormat: OFormat[UpdateTreeGroupVisibilitySkeletonAction] =
    Json.format[UpdateTreeGroupVisibilitySkeletonAction]
}
object UpdateTreeEdgesVisibilitySkeletonAction {
  implicit val jsonFormat: OFormat[UpdateTreeEdgesVisibilitySkeletonAction] =
    Json.format[UpdateTreeEdgesVisibilitySkeletonAction]
}
object UpdateUserBoundingBoxesSkeletonAction {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxesSkeletonAction] =
    Json.format[UpdateUserBoundingBoxesSkeletonAction]
}
object UpdateUserBoundingBoxVisibilitySkeletonAction {
  implicit val jsonFormat: OFormat[UpdateUserBoundingBoxVisibilitySkeletonAction] =
    Json.format[UpdateUserBoundingBoxVisibilitySkeletonAction]
}
object UpdateTreeGroupsExpandedStateSkeletonAction {
  implicit val jsonFormat: OFormat[UpdateTreeGroupsExpandedStateSkeletonAction] =
    Json.format[UpdateTreeGroupsExpandedStateSkeletonAction]
}
