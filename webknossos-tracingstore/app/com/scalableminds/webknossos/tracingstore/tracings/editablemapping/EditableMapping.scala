package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.webknossos.datastore.EditableMapping._

// TODO work on proto directly?
case class EditableMapping(
    baseMappingName: String,
    //segmentToAgglomerate: Map[Long, Long],
    //agglomerateToGraph: Map[Long, AgglomerateGraph],
    createdTimestamp: Long,
    largestAgglomerateId: Long
) {
  override def toString: String = f"EditableMapping(base=$baseMappingName)"

  def toProto: EditableMappingProto =
    EditableMappingProto(
      baseMappingName = baseMappingName,
//      segmentToAgglomerate = segmentToAgglomerate.map(tuple => SegmentToAgglomeratePair(tuple._1, tuple._2)).toSeq,
//      agglomerateToGraph = agglomerateToGraph.map(tuple => AgglomerateToGraphPair(tuple._1, tuple._2)).toSeq,
      createdTimestamp = createdTimestamp
    )
}

object EditableMapping {

  def fromProto(editableMappignProto: EditableMappingProto): EditableMapping =
    EditableMapping(
      baseMappingName = editableMappignProto.baseMappingName,
      /*      segmentToAgglomerate =
        editableMappignProto.segmentToAgglomerate.map(pair => pair.segmentId -> pair.agglomerateId).toMap,
      agglomerateToGraph =
        editableMappignProto.agglomerateToGraph.map(pair => pair.agglomerateId -> pair.agglomerateGraph).toMap, */
      createdTimestamp = editableMappignProto.createdTimestamp
    )

}
