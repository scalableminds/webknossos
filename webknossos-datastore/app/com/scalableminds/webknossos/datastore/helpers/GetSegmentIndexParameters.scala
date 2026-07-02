package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import play.api.libs.json.{Format, Json, OFormat}

case class GetSegmentIndexParameters(
    mag: Vec3Int,
    cubeSize: Vec3Int, // Use the cubeSize parameter to map the found bucket indices to different size of cubes (e.g. reducing granularity with higher cubeSize)
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    mappingName: Option[String], // Specify the mapping when querying the datastore
    annotationVersion: Option[Long]
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
    annotationVersion: Option[Long]
)

object GetMultipleSegmentIndexParameters {
  private val baseFormat: OFormat[GetMultipleSegmentIndexParameters] = Json.format[GetMultipleSegmentIndexParameters]
  implicit val format: Format[GetMultipleSegmentIndexParameters] =
    UnsignedLongJson.patchListField(baseFormat, "segmentIds")(_.segmentIds, (a, v) => a.copy(segmentIds = v))
}

// positions = List of indices of buckets directly in a requested mag
case class SegmentIndexData(segmentId: Long, positions: Seq[Vec3Int])

object SegmentIndexData {
  private val baseFormat: OFormat[SegmentIndexData] = Json.format[SegmentIndexData]
  implicit val format: Format[SegmentIndexData] =
    UnsignedLongJson.patchRequiredField(baseFormat, "segmentId")(_.segmentId, (a, v) => a.copy(segmentId = v))
}
