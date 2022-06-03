package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.AdditionalJsonFormats
import com.scalableminds.webknossos.datastore.EditableMapping.{
  AgglomerateToGraphPair,
  EditableMappingProto,
  SegmentToAgglomeratePair
}
import com.scalableminds.webknossos.datastore.models.AgglomerateGraph
import play.api.libs.json.{Json, OFormat}

case class EditableMapping(
    baseMappingName: String,
    segmentToAgglomerate: Map[Long, Long],
    agglomerateToGraph: Map[Long, AgglomerateGraph],
) {
  override def toString: String = f"EditableMapping(agglomerates:${agglomerateToGraph.keySet})"

  def toProto: EditableMappingProto =
    EditableMappingProto(
      baseMappingName = baseMappingName,
      segmentToAgglomerate = segmentToAgglomerate.map(tuple => SegmentToAgglomeratePair(tuple._1, tuple._2)).toSeq,
      agglomerateToGraph = agglomerateToGraph.map(tuple => AgglomerateToGraphPair(tuple._1, tuple._2.toProto)).toSeq,
    )
}

object EditableMapping extends AdditionalJsonFormats {
  implicit val jsonFormat: OFormat[EditableMapping] = Json.format[EditableMapping]

  def fromProto(editableMappignProto: EditableMappingProto): EditableMapping =
    EditableMapping(
      baseMappingName = editableMappignProto.baseMappingName,
      segmentToAgglomerate =
        editableMappignProto.segmentToAgglomerate.map(pair => pair.segmentId -> pair.agglomerateId).toMap,
      agglomerateToGraph = editableMappignProto.agglomerateToGraph
        .map(pair => pair.agglomerateId -> AgglomerateGraph.fromProto(pair.agglomerateGraph))
        .toMap
    )

  def createDummy(numSegments: Long, numAgglomerates: Long): EditableMapping =
    EditableMapping(
      baseMappingName = "dummyBaseMapping",
      segmentToAgglomerate = 1L.to(numSegments).map(s => s -> s % numAgglomerates).toMap,
      agglomerateToGraph = 1L
        .to(numAgglomerates)
        .map(a =>
          a -> AgglomerateGraph(
            segments = 1L.to(numSegments / numAgglomerates).toList,
            edges = 1L.to(numSegments / numAgglomerates).map(s => s -> s).toList,
            positions = 1L.to(numSegments / numAgglomerates).map(s => Vec3Int.full(s.toInt)).toList,
            affinities = 1L.to(numSegments / numAgglomerates).map(s => s.toFloat).toList
        ))
        .toMap
    )

}
