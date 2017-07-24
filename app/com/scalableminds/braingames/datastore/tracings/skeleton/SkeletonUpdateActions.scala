package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.image.Color
import com.scalableminds.braingames.datastore.tracings.skeleton.elements._
import play.api.libs.json._


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
    activeNodeId = activeNode match {case Some(_) => activeNode case None => tracing.activeNodeId},
    editPosition = editPosition match {case Some(_) => editPosition case None => tracing.editPosition},
    editRotation = editRotation match {case Some(_) => editRotation case None => tracing.editRotation},
    zoomLevel = zoomLevel match {case Some(_) => zoomLevel case None => tracing.zoomLevel})
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



object SkeletonUpdateAction {

  implicit object SkeletonUpdateActionReads extends Reads[SkeletonUpdateAction] {
    override def reads(json: JsValue): JsResult[SkeletonUpdateAction] = {
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
  }

  implicit object SkeletonUpdateActionWrites extends Writes[SkeletonUpdateAction] {
    override def writes(a: SkeletonUpdateAction) = a match{
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
    }
  }
}

case class SkeletonUpdateActionGroup(version: Long, timestamp: Long, actions: List[SkeletonUpdateAction])
object SkeletonUpdateActionGroup {implicit val jsonFormat = Json.format[SkeletonUpdateActionGroup]}