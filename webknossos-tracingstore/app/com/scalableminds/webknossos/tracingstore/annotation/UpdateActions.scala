package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.{
  CreateEdgeSkeletonAction,
  CreateNodeSkeletonAction,
  CreateTreeSkeletonAction,
  DeleteEdgeSkeletonAction,
  DeleteNodeSkeletonAction,
  DeleteTreeSkeletonAction,
  MergeTreeSkeletonAction,
  MoveTreeComponentSkeletonAction,
  RevertToVersionSkeletonAction,
  UpdateNodeSkeletonAction,
  UpdateTdCameraSkeletonAction,
  UpdateTracingSkeletonAction,
  UpdateTreeEdgesVisibilitySkeletonAction,
  UpdateTreeGroupVisibilitySkeletonAction,
  UpdateTreeGroupsSkeletonAction,
  UpdateTreeSkeletonAction,
  UpdateTreeVisibilitySkeletonAction,
  UpdateUserBoundingBoxVisibilitySkeletonAction,
  UpdateUserBoundingBoxesSkeletonAction
}
import play.api.libs.json.{Format, JsObject, JsPath, JsResult, JsValue, Json, OFormat, Reads}

trait GenericUpdateAction {
  def actionTimestamp: Option[Long]

  def addTimestamp(timestamp: Long): GenericUpdateAction

  def addInfo(info: Option[String]): GenericUpdateAction

  def addAuthorId(authorId: Option[String]): GenericUpdateAction
}

object GenericUpdateAction {

  implicit object genericUpdateActionFormat extends Format[GenericUpdateAction] {
    override def reads(json: JsValue): JsResult[GenericUpdateAction] = {
      val jsonValue = (json \ "value").as[JsObject]
      (json \ "name").as[String] match {
        case "createTree"                => deserialize[CreateTreeSkeletonAction](jsonValue)
        case "deleteTree"                => deserialize[DeleteTreeSkeletonAction](jsonValue)
        case "updateTree"                => deserialize[UpdateTreeSkeletonAction](jsonValue)
        case "mergeTree"                 => deserialize[MergeTreeSkeletonAction](jsonValue)
        case "moveTreeComponent"         => deserialize[MoveTreeComponentSkeletonAction](jsonValue)
        case "createNode"                => deserialize[CreateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
        case "deleteNode"                => deserialize[DeleteNodeSkeletonAction](jsonValue)
        case "updateNode"                => deserialize[UpdateNodeSkeletonAction](jsonValue, shouldTransformPositions = true)
        case "createEdge"                => deserialize[CreateEdgeSkeletonAction](jsonValue)
        case "deleteEdge"                => deserialize[DeleteEdgeSkeletonAction](jsonValue)
        case "updateTreeGroups"          => deserialize[UpdateTreeGroupsSkeletonAction](jsonValue)
        case "updateTracing"             => deserialize[UpdateTracingSkeletonAction](jsonValue)
        case "revertToVersion"           => deserialize[RevertToVersionSkeletonAction](jsonValue)
        case "updateTreeVisibility"      => deserialize[UpdateTreeVisibilitySkeletonAction](jsonValue)
        case "updateTreeGroupVisibility" => deserialize[UpdateTreeGroupVisibilitySkeletonAction](jsonValue)
        case "updateTreeEdgesVisibility" => deserialize[UpdateTreeEdgesVisibilitySkeletonAction](jsonValue)
        case "updateUserBoundingBoxes"   => deserialize[UpdateUserBoundingBoxesSkeletonAction](jsonValue)
        case "updateUserBoundingBoxVisibility" =>
          deserialize[UpdateUserBoundingBoxVisibilitySkeletonAction](jsonValue)
        case "updateTdCamera" => deserialize[UpdateTdCameraSkeletonAction](jsonValue)
      }
    }

    private def deserialize[T](json: JsValue, shouldTransformPositions: Boolean = false)(
        implicit tjs: Reads[T]): JsResult[T] =
      if (shouldTransformPositions)
        json.transform(positionTransform).get.validate[T]
      else
        json.validate[T]

    private val positionTransform =
      (JsPath \ "position").json.update(JsPath.read[List[Float]].map(position => Json.toJson(position.map(_.toInt))))

    override def writes(a: GenericUpdateAction): JsObject = a match {
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
      case s: RevertToVersionSkeletonAction =>
        Json.obj("name" -> "revertToVersion", "value" -> Json.toJson(s)(RevertToVersionSkeletonAction.jsonFormat))
      case s: UpdateTreeVisibilitySkeletonAction =>
        Json.obj("name" -> "updateTreeVisibility",
                 "value" -> Json.toJson(s)(UpdateTreeVisibilitySkeletonAction.jsonFormat))
      case s: UpdateTreeGroupVisibilitySkeletonAction =>
        Json.obj("name" -> "updateTreeGroupVisibility",
                 "value" -> Json.toJson(s)(UpdateTreeGroupVisibilitySkeletonAction.jsonFormat))
      case s: UpdateTreeEdgesVisibilitySkeletonAction =>
        Json.obj("name" -> "updateTreeEdgesVisibility",
                 "value" -> Json.toJson(s)(UpdateTreeEdgesVisibilitySkeletonAction.jsonFormat))
      case s: UpdateUserBoundingBoxesSkeletonAction =>
        Json.obj("name" -> "updateUserBoundingBoxes",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxesSkeletonAction.jsonFormat))
      case s: UpdateUserBoundingBoxVisibilitySkeletonAction =>
        Json.obj("name" -> "updateUserBoundingBoxVisibility",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxVisibilitySkeletonAction.jsonFormat))
      case s: UpdateTdCameraSkeletonAction =>
        Json.obj("name" -> "updateTdCamera", "value" -> Json.toJson(s)(UpdateTdCameraSkeletonAction.jsonFormat))
    }
  }
}

case class GenericUpdateActionGroup(version: Long,
                                    timestamp: Long,
                                    authorId: Option[String],
                                    actions: List[GenericUpdateAction],
                                    stats: Option[JsObject],
                                    info: Option[String],
                                    transactionId: String,
                                    transactionGroupCount: Int,
                                    transactionGroupIndex: Int) {

  def significantChangesCount: Int = 1 // TODO

  def viewChangesCount: Int = 1 // TODO
}

object GenericUpdateActionGroup {
  implicit val jsonFormat: OFormat[GenericUpdateActionGroup] = Json.format[GenericUpdateActionGroup]
}
