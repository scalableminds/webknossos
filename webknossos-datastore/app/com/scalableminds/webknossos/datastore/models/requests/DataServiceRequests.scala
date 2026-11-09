package com.scalableminds.webknossos.datastore.models.requests

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, SegmentationLayer}

case class DataServiceRequestSettings(
    halfByte: Boolean = false,
    appliedAgglomerate: Option[String] = None,
    version: Option[Long] = None,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
    // If true, buckets whose underlying chunk is missing on disk (and whose fill value is 0) are answered with Empty
    // instead of a fill-value-filled array. Only applies where the bucket matches the chunk exactly. Opt-in, because
    // most internal callers expect data bytes for every bucket.
    emptyIfChunkMissing: Boolean = false
)

case class DataServiceDataRequest(
    datasetId: Option[ObjectId], // None in case of volume tracings
    dataSourceId: Option[DataSourceId], // None in case of volume tracings
    dataLayer: DataLayer,
    cuboid: Cuboid,
    settings: DataServiceRequestSettings
) {
  def isSingleBucket: Boolean = cuboid.isSingleBucket(DataLayer.bucketLength)
  def mag: Vec3Int = cuboid.mag

  // dataSource is None and unused for volume tracings. Insert dummy DataSourceId
  // (also unused in that case, except for logging and bucket provider cache key)
  def dataSourceIdOrVolumeDummy: DataSourceId = dataSourceId.getOrElse(DataSourceId("VolumeTracing", dataLayer.name))

  lazy val isBatchedAdditionalCoordinateRequest: Boolean =
    settings.additionalCoordinates.exists(_.exists(_.length.exists(_ > 1)))
}

case class DataReadInstruction(
    dataSourceId: DataSourceId, // Dummy value in case of volume tracings
    dataLayer: DataLayer,
    bucket: BucketPosition,
    version: Option[Long] = None,
    emptyIfChunkMissing: Boolean = false
) {
  def layerSummary: String = f"$dataSourceId/${dataLayer.name}"
}

case class DataServiceMappingRequest(
    dataSourceId: Option[DataSourceId], // None in case of volume tracings
    dataLayer: SegmentationLayer,
    mapping: String
) {
  // dataSource is None and unused for volume tracings. Insert dummy DataSourceId
  // (also unused in that case, except for logging and bucket provider cache key)
  def dataSourceIdOrVolumeDummy: DataSourceId = dataSourceId.getOrElse(DataSourceId("VolumeTracing", dataLayer.name))
}
