package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.AutoFormat
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate

case class GetSegmentIndexParameters(
    mag: Vec3Int,
    cubeSize: Vec3Int, // Use the cubeSize parameter to map the found bucket indices to different size of cubes (e.g. reducing granularity with higher cubeSize)
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    mappingName: Option[String], // Specify the mapping when querying the datastore
    annotationVersion: Option[Long]
) derives AutoFormat

case class GetMultipleSegmentIndexParameters(
    segmentIds: List[UnsignedLong],
    mag: Vec3Int,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    mappingName: Option[String],
    editableMappingTracingId: Option[String],
    annotationVersion: Option[Long]
) derives AutoFormat

// positions = List of indices of buckets directly in a requested mag
case class SegmentIndexData(segmentId: UnsignedLong, positions: Seq[Vec3Int]) derives AutoFormat
