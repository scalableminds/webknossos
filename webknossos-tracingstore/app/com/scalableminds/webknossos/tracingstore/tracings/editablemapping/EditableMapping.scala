package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

case class EditableMapping(
    baseMappingName: String,
    segmentToAgglomerate: Map[Long, Long],
    agglomerateToSegments: Map[Long, List[Long]],
    agglomerateToEdges: Map[Long, List[(Long, Long)]],
    agglomerateToAffinities: Map[Long, List[Long]]
) {
  def toBytes: Array[Byte] = ???
}
