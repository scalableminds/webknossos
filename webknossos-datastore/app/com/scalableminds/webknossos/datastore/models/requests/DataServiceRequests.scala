package com.scalableminds.webknossos.datastore.models.requests

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, SegmentationLayer}

import java.nio.file.Path

case class DataServiceRequestSettings(halfByte: Boolean = false,
                                      appliedAgglomerate: Option[String] = None,
                                      version: Option[Long] = None,
                                      additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None)

object DataServiceRequestSettings {
  val default: DataServiceRequestSettings = DataServiceRequestSettings(halfByte = false)
}

case class DataServiceDataRequest(
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
}

case class DataReadInstruction(
    baseDir: Path,
    dataSourceId: DataSourceId, // Dummy value in case of volume tracings
    dataLayer: DataLayer,
    bucket: BucketPosition,
    version: Option[Long] = None
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

case class MappingReadInstruction(
    baseDir: Path,
    dataSourceId: DataSourceId, // Dummy value in case of volume tracings
    mapping: String
)
