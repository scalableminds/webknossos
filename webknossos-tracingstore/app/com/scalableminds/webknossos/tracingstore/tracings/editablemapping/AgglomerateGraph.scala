package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int
import play.api.libs.json.{Json, OFormat}

case class AgglomerateGraph(segments: List[Long],
                            edges: List[(Long, Long)],
                            positions: List[Vec3Int],
                            affinities: List[Long])

object AgglomerateGraph {
  implicit val jsonFormat: OFormat[AgglomerateGraph] = Json.format[AgglomerateGraph]

  def empty: AgglomerateGraph = AgglomerateGraph(List.empty, List.empty, List.empty, List.empty)
}
