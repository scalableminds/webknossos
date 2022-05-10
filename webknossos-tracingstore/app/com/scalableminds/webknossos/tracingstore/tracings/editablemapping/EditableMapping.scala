package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.Vec3Int

case class EditableMapping(
    baseMappingName: String,
    segmentToAgglomerate: Map[Long, Long],
    agglomerateToSegments: Map[Long, List[Long]],
    agglomerateToEdges: Map[Long, List[(Long, Long)]],
    agglomerateToPositions: Map[Long, List[Vec3Int]],
    agglomerateToAffinities: Map[Long, List[Long]]
) {
  def toBytes: Array[Byte] = ???
}

object EditableMapping {
  def fromBytes(bytes: Array[Byte]): EditableMapping = ???
}
