package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import com.scalableminds.webknossos.tracingstore.annotation.{LayerUpdateAction, UpdateAction}

trait EditableMappingUpdateAction extends LayerUpdateAction {
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class SplitAgglomerateUpdateAction(
    agglomerateId: Option[UnsignedLong], // Unused, we now look this up by position/segment
    segmentPosition1: Option[Vec3Int],
    segmentPosition2: Option[Vec3Int],
    segmentId1: Option[UnsignedLong],
    segmentId2: Option[UnsignedLong],
    mag: Option[Vec3Int],
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends EditableMappingUpdateAction derives JsonAutoFormat {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}

// we switched from positions to segment ids in https://github.com/scalableminds/webknossos/pull/7742.
// Both are now optional to support applying old update actions stored in the db.
case class MergeAgglomerateUpdateAction(
    agglomerateId1: Option[UnsignedLong], // Unused, we now look this up by position/segment
    agglomerateId2: Option[UnsignedLong], // Unused, we now look this up by position/segment
    segmentPosition1: Option[Vec3Int],
    segmentPosition2: Option[Vec3Int],
    segmentId1: Option[UnsignedLong],
    segmentId2: Option[UnsignedLong],
    mag: Option[Vec3Int],
    actionTracingId: String,
    actionTimestamp: Option[Long] = None,
    actionAuthorId: Option[ObjectId] = None,
    info: Option[String] = None
) extends EditableMappingUpdateAction derives JsonAutoFormat {
  override def addTimestamp(timestamp: Long): EditableMappingUpdateAction = this.copy(actionTimestamp = Some(timestamp))
  override def addInfo(info: Option[String]): UpdateAction = this.copy(info = info)
  override def addAuthorId(authorId: Option[ObjectId]): UpdateAction =
    this.copy(actionAuthorId = authorId)
  override def withActionTracingId(newTracingId: String): EditableMappingUpdateAction =
    this.copy(actionTracingId = newTracingId)
}
