package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.tracingstore.annotation.{LayerUpdateAction, UpdateAction}
import play.api.libs.json.*

trait EditableMappingUpdateAction extends LayerUpdateAction {
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class SplitAgglomerateUpdateAction(
    agglomerateId: Option[Long], // Unused, we now look this up by position/segment
    segmentPosition1: Option[Vec3Int],
    segmentPosition2: Option[Vec3Int],
    segmentId1: Option[Long],
    segmentId2: Option[Long],
    mag: Option[Vec3Int],
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object SplitAgglomerateUpdateAction {
  implicit val jsonFormat: OFormat[SplitAgglomerateUpdateAction] = Json.format[SplitAgglomerateUpdateAction]
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class MergeAgglomerateUpdateAction(
    agglomerateId1: Option[Long], // Unused, we now look this up by position/segment
    agglomerateId2: Option[Long], // Unused, we now look this up by position/segment
    segmentPosition1: Option[Vec3Int],
    segmentPosition2: Option[Vec3Int],
    segmentId1: Option[Long],
    segmentId2: Option[Long],
    mag: Option[Vec3Int],
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object MergeAgglomerateUpdateAction {
  implicit val jsonFormat: OFormat[MergeAgglomerateUpdateAction] = Json.format[MergeAgglomerateUpdateAction]
}

// Sets the mapping level for the agglomerate that contains a single anchor segment (identified by segmentId, or by
// position+mag for parity with split/merge). Expanded server-side in EditableMappingUpdater into the equivalent
// split/merge edge changes and applied as one atomic version. See SPIKE-per-agglomerate-mapping-level.md.
case class SetAgglomerateMappingLevelUpdateAction(
    segmentId: Option[Long],
    segmentPosition: Option[Vec3Int],
    mag: Option[Vec3Int],
    targetMappingName: String,
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends EditableMappingUpdateAction {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

object SetAgglomerateMappingLevelUpdateAction {
  implicit val jsonFormat: OFormat[SetAgglomerateMappingLevelUpdateAction] =
    Json.format[SetAgglomerateMappingLevelUpdateAction]
}
