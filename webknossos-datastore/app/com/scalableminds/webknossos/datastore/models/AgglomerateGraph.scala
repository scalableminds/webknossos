package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.EditableMapping.AgglomerateEdge
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import play.api.libs.json.{Json, OFormat}

case class AgglomerateGraph(segments: List[Long],
                            edges: List[(Long, Long)],
                            positions: List[Vec3Int],
                            affinities: List[Float])
    extends ProtoGeometryImplicits {
  override def toString: String =
    f"AgglomerateGraph(${segments.length} segments, ${edges.length} edges)"

  def toProto: com.scalableminds.webknossos.datastore.EditableMapping.AgglomerateGraph =
    com.scalableminds.webknossos.datastore.EditableMapping.AgglomerateGraph(
      segments = segments,
      edges = edges.map(e => AgglomerateEdge(e._1, e._2)),
      positions = positions.map(vec3IntToProto),
      affinities = affinities
    )
}

object AgglomerateGraph extends ProtoGeometryImplicits {
  implicit val jsonFormat: OFormat[AgglomerateGraph] = Json.format[AgglomerateGraph]

  def empty: AgglomerateGraph = AgglomerateGraph(List.empty, List.empty, List.empty, List.empty)

  def fromProto(agglomerateGraphProto: com.scalableminds.webknossos.datastore.EditableMapping.AgglomerateGraph)
    : AgglomerateGraph =
    AgglomerateGraph(
      segments = agglomerateGraphProto.segments.toList,
      edges = agglomerateGraphProto.edges.map(e => (e.source, e.target)).toList,
      positions = agglomerateGraphProto.positions.map(vec3IntFromProto).toList,
      affinities = agglomerateGraphProto.affinities.toList
    )
}
