package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int

trait EditableMappingUpdateAction {
  def applyOn(editableMapping: EditableMapping): EditableMapping
}

case class SplitAgglomerateUpdateAction(agglomerateId: Long, segmentId1: Long, segmentId2: Long)
    extends EditableMappingUpdateAction {
  def applyOn(editableMapping: EditableMapping): EditableMapping = ???
}

case class MergeAgglomerateUpdateAction(agglomerateId1: Long,
                                        agglomerateId2: Long,
                                        segmentId1: Long,
                                        segmentPosition2: Vec3Int)
    extends EditableMappingUpdateAction {

  def applyOn(editableMapping: EditableMapping): EditableMapping = ???
}
