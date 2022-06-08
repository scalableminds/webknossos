package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.webknossos.datastore.EditableMapping._

case class EditableMapping(
    baseMappingName: String,
    segmentToAgglomerate: Map[Long, Long],
    agglomerateToGraph: Map[Long, AgglomerateGraph],
    createdTimestamp: Long,
) {
  override def toString: String = f"EditableMapping(agglomerates:${agglomerateToGraph.keySet})"

  def toProto: EditableMappingProto =
    EditableMappingProto(
      baseMappingName = baseMappingName,
      segmentToAgglomerate = segmentToAgglomerate.map(tuple => SegmentToAgglomeratePair(tuple._1, tuple._2)).toSeq,
      agglomerateToGraph = agglomerateToGraph.map(tuple => AgglomerateToGraphPair(tuple._1, tuple._2)).toSeq,
      createdTimestamp = createdTimestamp
    )
}

object EditableMapping {

  def fromProto(editableMappignProto: EditableMappingProto): EditableMapping =
    EditableMapping(
      baseMappingName = editableMappignProto.baseMappingName,
      segmentToAgglomerate =
        editableMappignProto.segmentToAgglomerate.map(pair => pair.segmentId -> pair.agglomerateId).toMap,
      agglomerateToGraph =
        editableMappignProto.agglomerateToGraph.map(pair => pair.agglomerateId -> pair.agglomerateGraph).toMap,
      createdTimestamp = editableMappignProto.createdTimestamp
    )

  /*
  def createDummy(numSegments: Long, numAgglomerates: Long): EditableMapping =
    EditableMapping(
      baseMappingName = "dummyBaseMapping",
      segmentToAgglomerate = 1L.to(numSegments).map(s => s -> s % numAgglomerates).toMap,
      agglomerateToGraph = 1L
        .to(numAgglomerates)
        .map(a =>
          a -> AgglomerateGraph(
            segments = 1L.to(numSegments / numAgglomerates),
            edges = 1L.to(numSegments / numAgglomerates).map(s => AgglomerateEdge(s, s)),
            positions = 1L.to(numSegments / numAgglomerates).map(s => Vec3IntProto(s.toInt, s.toInt, s.toInt)),
            affinities = 1L.to(numSegments / numAgglomerates).map(s => s.toFloat)
        ))
        .toMap
    )
 */

}
