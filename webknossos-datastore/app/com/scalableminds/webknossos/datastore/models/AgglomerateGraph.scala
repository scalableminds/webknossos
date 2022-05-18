package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.Vec3Int
import play.api.libs.json.{Json, OFormat}

case class AgglomerateGraph(segments: List[Long],
                            edges: List[(Long, Long)],
                            positions: List[Vec3Int],
                            affinities: List[Float]) {
  override def toString: String =
    f"AgglomerateGraph(${segments.length} segments, ${edges.length} edges)"
}

object AgglomerateGraph {
  implicit val jsonFormat: OFormat[AgglomerateGraph] = Json.format[AgglomerateGraph]

  def empty: AgglomerateGraph = AgglomerateGraph(List.empty, List.empty, List.empty, List.empty)
}
