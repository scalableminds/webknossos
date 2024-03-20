package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import play.api.libs.json.{Format, Json}

case class GetSegmentIndexParameters(
    mag: Vec3Int,
    cubeSize: Vec3Int, // Use the cubeSize parameter to map the found bucket indices to different size of cubes (e.g. reducing granularity with higher cubeSize)
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    mappingName: Option[String], // Specify the mapping when querying the datastore
    editableMappingTracingId: Option[String]
)

object GetSegmentIndexParameters {
  implicit val format: Format[GetSegmentIndexParameters] = Json.format[GetSegmentIndexParameters]
}

case class GetMultipleSegmentIndexParameters(
    segmentIds: List[Long],
    mag: Vec3Int,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    mappingName: Option[String],
    editableMappingTracingId: Option[String],
)

object GetMultipleSegmentIndexParameters {
  implicit val format: Format[GetMultipleSegmentIndexParameters] = Json.format[GetMultipleSegmentIndexParameters]
}

// positions = List of indices of buckets directly in a requested mag
case class SegmentIndexData(segmentId: Long, positions: Seq[Vec3Int])

object SegmentIndexData {
  implicit val format: Format[SegmentIndexData] = Json.format[SegmentIndexData]
}
