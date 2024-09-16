package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  MergeAgglomerateUpdateAction,
  SplitAgglomerateUpdateAction
}
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
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  CompactVolumeUpdateAction,
  CreateSegmentVolumeAction,
  DeleteSegmentDataVolumeAction,
  DeleteSegmentVolumeAction,
  ImportVolumeDataVolumeAction,
  RemoveFallbackLayerVolumeAction,
  UpdateBucketVolumeAction,
  UpdateMappingNameVolumeAction,
  UpdateSegmentGroupsVolumeAction,
  UpdateSegmentVolumeAction,
  UpdateTdCameraVolumeAction,
  UpdateTracingVolumeAction,
  UpdateUserBoundingBoxVisibilityVolumeAction,
  UpdateUserBoundingBoxesVolumeAction
}
import play.api.libs.json.{Format, JsError, JsObject, JsPath, JsResult, JsValue, Json, OFormat, Reads}

trait UpdateAction {
  def actionTimestamp: Option[Long]

  def addTimestamp(timestamp: Long): UpdateAction

  def addInfo(info: Option[String]): UpdateAction

  def addAuthorId(authorId: Option[String]): UpdateAction

  def isViewOnlyChange: Boolean = false
}

trait LayerUpdateAction extends UpdateAction {
  def actionTracingId: String
}

object UpdateAction {

  implicit object updateActionFormat extends Format[UpdateAction] {
    override def reads(json: JsValue): JsResult[UpdateAction] = {
      val jsonValue = (json \ "value").as[JsObject]
      (json \ "name").as[String] match {
        // Skeleton
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
        case "updateSkeletonTracing"     => deserialize[UpdateTracingSkeletonAction](jsonValue)
        case "updateTreeVisibility"      => deserialize[UpdateTreeVisibilitySkeletonAction](jsonValue)
        case "updateTreeGroupVisibility" => deserialize[UpdateTreeGroupVisibilitySkeletonAction](jsonValue)
        case "updateTreeEdgesVisibility" => deserialize[UpdateTreeEdgesVisibilitySkeletonAction](jsonValue)
        case "updateUserBoundingBoxes"   => deserialize[UpdateUserBoundingBoxesSkeletonAction](jsonValue)
        case "updateUserBoundingBoxVisibility" =>
          deserialize[UpdateUserBoundingBoxVisibilitySkeletonAction](jsonValue)

        // Volume
        case "updateBucket"        => deserialize[UpdateBucketVolumeAction](jsonValue)
        case "updateVolumeTracing" => deserialize[UpdateTracingVolumeAction](jsonValue)
        case "updateUserBoundingBoxes" =>
          deserialize[UpdateUserBoundingBoxesVolumeAction](jsonValue) // TODO: rename key (must be different from skeleton action)
        case "updateUserBoundingBoxVisibility" => deserialize[UpdateUserBoundingBoxVisibilityVolumeAction](jsonValue)
        case "removeFallbackLayer"             => deserialize[RemoveFallbackLayerVolumeAction](jsonValue)
        case "importVolumeTracing"             => deserialize[ImportVolumeDataVolumeAction](jsonValue)
        case "updateTdCameraSkeleton"          => deserialize[UpdateTdCameraSkeletonAction](jsonValue) // TODO deduplicate?
        case "updateTdCameraVolume"            => deserialize[UpdateTdCameraVolumeAction](jsonValue)
        case "createSegment"                   => deserialize[CreateSegmentVolumeAction](jsonValue)
        case "updateSegment"                   => deserialize[UpdateSegmentVolumeAction](jsonValue)
        case "updateSegmentGroups"             => deserialize[UpdateSegmentGroupsVolumeAction](jsonValue)
        case "deleteSegment"                   => deserialize[DeleteSegmentVolumeAction](jsonValue)
        case "deleteSegmentData"               => deserialize[DeleteSegmentDataVolumeAction](jsonValue)
        case "updateMappingName"               => deserialize[UpdateMappingNameVolumeAction](jsonValue)

        // Editable Mapping
        case "mergeAgglomerate" => deserialize[MergeAgglomerateUpdateAction](jsonValue)
        case "splitAgglomerate" => deserialize[SplitAgglomerateUpdateAction](jsonValue)

        // Annotation
        case "addLayerToAnnotation"       => deserialize[AddLayerAnnotationUpdateAction](jsonValue)
        case "deleteLayerFromAnnotation"  => deserialize[DeleteLayerAnnotationUpdateAction](jsonValue)
        case "updateLayerMetadata"        => deserialize[UpdateLayerMetadataAnnotationUpdateAction](jsonValue)
        case "updateMetadataOfAnnotation" => deserialize[UpdateMetadataAnnotationUpdateAction](jsonValue)

        case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
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

    override def writes(a: UpdateAction): JsValue = a match {
      // Skeleton
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
        Json.obj("name" -> "updateSkeletonTracing", "value" -> Json.toJson(s)(UpdateTracingSkeletonAction.jsonFormat))
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
        Json.obj("name" -> "updateTdCameraSkeleton", "value" -> Json.toJson(s)(UpdateTdCameraSkeletonAction.jsonFormat))

      // Volume
      case s: UpdateBucketVolumeAction =>
        Json.obj("name" -> "updateBucket", "value" -> Json.toJson(s)(UpdateBucketVolumeAction.jsonFormat))
      case s: UpdateTracingVolumeAction =>
        Json.obj("name" -> "updateVolumeTracing", "value" -> Json.toJson(s)(UpdateTracingVolumeAction.jsonFormat))
      case s: UpdateUserBoundingBoxesVolumeAction =>
        Json.obj("name" -> "updateUserBoundingBoxes",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxesVolumeAction.jsonFormat))
      case s: UpdateUserBoundingBoxVisibilityVolumeAction =>
        Json.obj("name" -> "updateUserBoundingBoxVisibility",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxVisibilityVolumeAction.jsonFormat))
      case s: RemoveFallbackLayerVolumeAction =>
        Json.obj("name" -> "removeFallbackLayer", "value" -> Json.toJson(s)(RemoveFallbackLayerVolumeAction.jsonFormat))
      case s: ImportVolumeDataVolumeAction =>
        Json.obj("name" -> "importVolumeTracing", "value" -> Json.toJson(s)(ImportVolumeDataVolumeAction.jsonFormat))
      case s: UpdateTdCameraVolumeAction =>
        Json.obj("name" -> "updateTdCameraVolume", "value" -> Json.toJson(s)(UpdateTdCameraVolumeAction.jsonFormat))
      case s: CreateSegmentVolumeAction =>
        Json.obj("name" -> "createSegment", "value" -> Json.toJson(s)(CreateSegmentVolumeAction.jsonFormat))
      case s: UpdateSegmentVolumeAction =>
        Json.obj("name" -> "updateSegment", "value" -> Json.toJson(s)(UpdateSegmentVolumeAction.jsonFormat))
      case s: DeleteSegmentVolumeAction =>
        Json.obj("name" -> "deleteSegment", "value" -> Json.toJson(s)(DeleteSegmentVolumeAction.jsonFormat))
      case s: UpdateSegmentGroupsVolumeAction =>
        Json.obj("name" -> "updateSegmentGroups", "value" -> Json.toJson(s)(UpdateSegmentGroupsVolumeAction.jsonFormat))
      case s: CompactVolumeUpdateAction => Json.toJson(s)(CompactVolumeUpdateAction.compactVolumeUpdateActionFormat)
      case s: UpdateMappingNameVolumeAction =>
        Json.obj("name" -> "updateMappingName", "value" -> Json.toJson(s)(UpdateMappingNameVolumeAction.jsonFormat))

      // Editable Mapping
      case s: SplitAgglomerateUpdateAction =>
        Json.obj("name" -> "splitAgglomerate", "value" -> Json.toJson(s)(SplitAgglomerateUpdateAction.jsonFormat))
      case s: MergeAgglomerateUpdateAction =>
        Json.obj("name" -> "mergeAgglomerate", "value" -> Json.toJson(s)(MergeAgglomerateUpdateAction.jsonFormat))

      // Annotation
      case s: AddLayerAnnotationUpdateAction =>
        Json.obj("name" -> "addLayerToAnnotation", "value" -> Json.toJson(s)(AddLayerAnnotationUpdateAction.jsonFormat))
      case s: DeleteLayerAnnotationUpdateAction =>
        Json.obj("name" -> "deleteLayerFromAnnotation",
                 "value" -> Json.toJson(s)(DeleteLayerAnnotationUpdateAction.jsonFormat))
      case s: UpdateLayerMetadataAnnotationUpdateAction =>
        Json.obj("name" -> "updateLayerMetadata",
                 "value" -> Json.toJson(s)(UpdateLayerMetadataAnnotationUpdateAction.jsonFormat))
      case s: UpdateMetadataAnnotationUpdateAction =>
        Json.obj("name" -> "updateMetadataOfAnnotation",
                 "value" -> Json.toJson(s)(UpdateMetadataAnnotationUpdateAction.jsonFormat))
    }
  }
}

case class UpdateActionGroup(version: Long,
                             timestamp: Long,
                             authorId: Option[String],
                             actions: List[UpdateAction],
                             stats: Option[JsObject],
                             info: Option[String],
                             transactionId: String,
                             transactionGroupCount: Int,
                             transactionGroupIndex: Int) {

  def significantChangesCount: Int = 1 // TODO

  def viewChangesCount: Int = 1 // TODO
}

object UpdateActionGroup {
  implicit val jsonFormat: OFormat[UpdateActionGroup] = Json.format[UpdateActionGroup]
}
