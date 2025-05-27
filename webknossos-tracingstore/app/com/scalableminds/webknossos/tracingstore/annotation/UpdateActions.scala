package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.{
  MergeAgglomerateUpdateAction,
  SplitAgglomerateUpdateAction
}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating._
import com.scalableminds.webknossos.tracingstore.tracings.volume.{UpdateUserBoundingBoxVolumeAction, _}
import play.api.libs.json._

trait UpdateAction {
  def actionTimestamp: Option[Long]

  def addTimestamp(timestamp: Long): UpdateAction

  def addInfo(info: Option[String]): UpdateAction

  def addAuthorId(authorId: Option[String]): UpdateAction

  def isViewOnlyChange: Boolean = false
}

trait ApplyImmediatelyUpdateAction extends UpdateAction

trait LayerUpdateAction extends UpdateAction {
  def actionTracingId: String
  def withActionTracingId(newTracingId: String): LayerUpdateAction
}

object UpdateAction {

  implicit object updateActionFormat extends Format[UpdateAction] {
    override def reads(json: JsValue): JsResult[UpdateAction] = {
      val jsonValue = (json \ "value").as[JsObject]
      if ((json \ "isCompacted").asOpt[Boolean].getOrElse(false)) {
        deserialize[CompactVolumeUpdateAction](json)
      } else {
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
          case "updateUserBoundingBoxesInSkeletonTracing" =>
            deserialize[UpdateUserBoundingBoxesSkeletonAction](jsonValue)
          case "addUserBoundingBoxInSkeletonTracing"    => deserialize[AddUserBoundingBoxSkeletonAction](jsonValue)
          case "deleteUserBoundingBoxInSkeletonTracing" => deserialize[DeleteUserBoundingBoxSkeletonAction](jsonValue)
          case "updateUserBoundingBoxInSkeletonTracing" =>
            deserialize[UpdateUserBoundingBoxSkeletonAction](jsonValue)
          case "updateUserBoundingBoxVisibilityInSkeletonTracing" =>
            deserialize[UpdateUserBoundingBoxVisibilitySkeletonAction](jsonValue)

          // Volume
          case "updateBucket"        => deserialize[UpdateBucketVolumeAction](jsonValue)
          case "updateVolumeTracing" => deserialize[UpdateTracingVolumeAction](jsonValue)
          case "updateUserBoundingBoxesInVolumeTracing" =>
            deserialize[UpdateUserBoundingBoxesVolumeAction](jsonValue)
          case "addUserBoundingBoxInVolumeTracing"    => deserialize[AddUserBoundingBoxVolumeAction](jsonValue)
          case "deleteUserBoundingBoxInVolumeTracing" => deserialize[DeleteUserBoundingBoxVolumeAction](jsonValue)
          case "updateUserBoundingBoxInVolumeTracing" =>
            deserialize[UpdateUserBoundingBoxVolumeAction](jsonValue)
          case "updateUserBoundingBoxVisibilityInVolumeTracing" =>
            deserialize[UpdateUserBoundingBoxVisibilityVolumeAction](jsonValue)
          case "removeFallbackLayer"          => deserialize[RemoveFallbackLayerVolumeAction](jsonValue)
          case "importVolumeTracing"          => deserialize[ImportVolumeDataVolumeAction](jsonValue)
          case "createSegment"                => deserialize[CreateSegmentVolumeAction](jsonValue)
          case "updateSegment"                => deserialize[UpdateSegmentVolumeAction](jsonValue)
          case "updateSegmentGroups"          => deserialize[UpdateSegmentGroupsVolumeAction](jsonValue)
          case "updateSegmentGroupVisibility" => deserialize[UpdateSegmentGroupVisibilityVolumeAction](jsonValue)
          case "updateSegmentVisibility"      => deserialize[UpdateSegmentVisibilityVolumeAction](jsonValue)
          case "deleteSegment"                => deserialize[DeleteSegmentVolumeAction](jsonValue)
          case "deleteSegmentData"            => deserialize[DeleteSegmentDataVolumeAction](jsonValue)
          case "updateMappingName"            => deserialize[UpdateMappingNameVolumeAction](jsonValue)
          case "addSegmentIndex"              => deserialize[AddSegmentIndexVolumeAction](jsonValue)

          // Editable Mapping
          case "mergeAgglomerate" => deserialize[MergeAgglomerateUpdateAction](jsonValue)
          case "splitAgglomerate" => deserialize[SplitAgglomerateUpdateAction](jsonValue)

          // Annotation
          case "addLayerToAnnotation"       => deserialize[AddLayerAnnotationAction](jsonValue)
          case "deleteLayerFromAnnotation"  => deserialize[DeleteLayerAnnotationAction](jsonValue)
          case "updateLayerMetadata"        => deserialize[UpdateLayerMetadataAnnotationAction](jsonValue)
          case "updateMetadataOfAnnotation" => deserialize[UpdateMetadataAnnotationAction](jsonValue)
          case "revertToVersion"            => deserialize[RevertToVersionAnnotationAction](jsonValue)
          case "resetToBase"                => deserialize[ResetToBaseAnnotationAction](jsonValue)
          case "updateTdCamera"             => deserialize[UpdateTdCameraAnnotationAction](jsonValue)

          case unknownAction: String => JsError(s"Invalid update action s'$unknownAction'")
        }
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
        Json.obj("name" -> "updateUserBoundingBoxesInSkeletonTracing",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxesSkeletonAction.jsonFormat))
      case s: AddUserBoundingBoxSkeletonAction =>
        Json.obj("name" -> "addUserBoundingBoxInSkeletonTracing",
                 "value" -> Json.toJson(s)(AddUserBoundingBoxSkeletonAction.jsonFormat))
      case s: DeleteUserBoundingBoxSkeletonAction =>
        Json.obj("name" -> "deleteUserBoundingBoxInSkeletonTracing",
                 "value" -> Json.toJson(s)(DeleteUserBoundingBoxSkeletonAction.jsonFormat))
      case s: UpdateUserBoundingBoxSkeletonAction =>
        Json.obj("name" -> "updateUserBoundingBoxInSkeletonTracing",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxSkeletonAction.jsonFormat))
      case s: UpdateUserBoundingBoxVisibilitySkeletonAction =>
        Json.obj("name" -> "updateUserBoundingBoxVisibilityInSkeletonTracing",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxVisibilitySkeletonAction.jsonFormat))

      // Volume
      case s: UpdateBucketVolumeAction =>
        Json.obj("name" -> "updateBucket", "value" -> Json.toJson(s)(UpdateBucketVolumeAction.jsonFormat))
      case s: UpdateTracingVolumeAction =>
        Json.obj("name" -> "updateVolumeTracing", "value" -> Json.toJson(s)(UpdateTracingVolumeAction.jsonFormat))
      case s: UpdateUserBoundingBoxesVolumeAction =>
        Json.obj("name" -> "updateUserBoundingBoxesInVolumeTracing",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxesVolumeAction.jsonFormat))
      case s: AddUserBoundingBoxVolumeAction =>
        Json.obj("name" -> "addUserBoundingBoxInVolumeTracing",
                 "value" -> Json.toJson(s)(AddUserBoundingBoxVolumeAction.jsonFormat))
      case s: DeleteUserBoundingBoxVolumeAction =>
        Json.obj("name" -> "deleteUserBoundingBoxInVolumeTracing",
                 "value" -> Json.toJson(s)(DeleteUserBoundingBoxVolumeAction.jsonFormat))
      case s: UpdateUserBoundingBoxVolumeAction =>
        Json.obj("name" -> "updateUserBoundingBoxInVolumeTracing",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxVolumeAction.jsonFormat))
      case s: UpdateUserBoundingBoxVisibilityVolumeAction =>
        Json.obj("name" -> "updateUserBoundingBoxVisibilityInVolumeTracing",
                 "value" -> Json.toJson(s)(UpdateUserBoundingBoxVisibilityVolumeAction.jsonFormat))
      case s: RemoveFallbackLayerVolumeAction =>
        Json.obj("name" -> "removeFallbackLayer", "value" -> Json.toJson(s)(RemoveFallbackLayerVolumeAction.jsonFormat))
      case s: ImportVolumeDataVolumeAction =>
        Json.obj("name" -> "importVolumeTracing", "value" -> Json.toJson(s)(ImportVolumeDataVolumeAction.jsonFormat))
      case s: CreateSegmentVolumeAction =>
        Json.obj("name" -> "createSegment", "value" -> Json.toJson(s)(CreateSegmentVolumeAction.jsonFormat))
      case s: UpdateSegmentVolumeAction =>
        Json.obj("name" -> "updateSegment", "value" -> Json.toJson(s)(UpdateSegmentVolumeAction.jsonFormat))
      case s: DeleteSegmentVolumeAction =>
        Json.obj("name" -> "deleteSegment", "value" -> Json.toJson(s)(DeleteSegmentVolumeAction.jsonFormat))
      case s: DeleteSegmentDataVolumeAction =>
        Json.obj("name" -> "deleteSegmentData", "value" -> Json.toJson(s)(DeleteSegmentDataVolumeAction.jsonFormat))
      case s: UpdateSegmentGroupsVolumeAction =>
        Json.obj("name" -> "updateSegmentGroups", "value" -> Json.toJson(s)(UpdateSegmentGroupsVolumeAction.jsonFormat))
      case s: UpdateSegmentVisibilityVolumeAction =>
        Json.obj("name" -> "updateSegmentVisibility",
                 "value" -> Json.toJson(s)(UpdateSegmentVisibilityVolumeAction.jsonFormat))
      case s: UpdateSegmentGroupVisibilityVolumeAction =>
        Json.obj("name" -> "updateSegmentGroupVisibility",
                 "value" -> Json.toJson(s)(UpdateSegmentGroupVisibilityVolumeAction.jsonFormat))
      case s: UpdateMappingNameVolumeAction =>
        Json.obj("name" -> "updateMappingName", "value" -> Json.toJson(s)(UpdateMappingNameVolumeAction.jsonFormat))
      case s: AddSegmentIndexVolumeAction =>
        Json.obj("name" -> "addSegmentIndex", "value" -> Json.toJson(s)(AddSegmentIndexVolumeAction.jsonFormat))
      case s: CompactVolumeUpdateAction =>
        Json.toJson(s)

      // Editable Mapping
      case s: SplitAgglomerateUpdateAction =>
        Json.obj("name" -> "splitAgglomerate", "value" -> Json.toJson(s)(SplitAgglomerateUpdateAction.jsonFormat))
      case s: MergeAgglomerateUpdateAction =>
        Json.obj("name" -> "mergeAgglomerate", "value" -> Json.toJson(s)(MergeAgglomerateUpdateAction.jsonFormat))

      // Annotation
      case s: AddLayerAnnotationAction =>
        Json.obj("name" -> "addLayerToAnnotation", "value" -> Json.toJson(s)(AddLayerAnnotationAction.jsonFormat))
      case s: DeleteLayerAnnotationAction =>
        Json.obj("name" -> "deleteLayerFromAnnotation",
                 "value" -> Json.toJson(s)(DeleteLayerAnnotationAction.jsonFormat))
      case s: UpdateLayerMetadataAnnotationAction =>
        Json.obj("name" -> "updateLayerMetadata",
                 "value" -> Json.toJson(s)(UpdateLayerMetadataAnnotationAction.jsonFormat))
      case s: UpdateMetadataAnnotationAction =>
        Json.obj("name" -> "updateMetadataOfAnnotation",
                 "value" -> Json.toJson(s)(UpdateMetadataAnnotationAction.jsonFormat))
      case s: RevertToVersionAnnotationAction =>
        Json.obj("name" -> "revertToVersion", "value" -> Json.toJson(s)(RevertToVersionAnnotationAction.jsonFormat))
      case s: ResetToBaseAnnotationAction =>
        Json.obj("name" -> "resetToBase", "value" -> Json.toJson(s)(ResetToBaseAnnotationAction.jsonFormat))
      case s: UpdateTdCameraAnnotationAction =>
        Json.obj("name" -> "updateTdCamera", "value" -> Json.toJson(s)(UpdateTdCameraAnnotationAction.jsonFormat))
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

  def significantChangesCount: Int = actions.count(!_.isViewOnlyChange)
  def viewChangesCount: Int = actions.count(_.isViewOnlyChange)
}

object UpdateActionGroup {
  implicit val jsonFormat: OFormat[UpdateActionGroup] = Json.format[UpdateActionGroup]
}
