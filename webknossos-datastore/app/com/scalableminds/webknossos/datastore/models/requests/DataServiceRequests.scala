package com.scalableminds.webknossos.datastore.models.requests

import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, SegmentationLayer}

import java.nio.file.Path

case class DataServiceRequestSettings(halfByte: Boolean = false,
                                      appliedAgglomerate: Option[String] = None,
                                      version: Option[Long] = None,
                                      additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None)

object DataServiceRequestSettings {
  val default: DataServiceRequestSettings = DataServiceRequestSettings(halfByte = false)
}

case class DataServiceDataRequest(
    dataSource: DataSource, // null in VolumeTracings
    dataLayer: DataLayer,
    cuboid: Cuboid,
    settings: DataServiceRequestSettings
) {
  def isSingleBucket: Boolean = cuboid.isSingleBucket(DataLayer.bucketLength)
}

case class DataReadInstruction(
    baseDir: Path,
    dataSource: DataSource,
    dataLayer: DataLayer,
    bucket: BucketPosition,
    version: Option[Long] = None
) {
  def layerSummary: String = f"${dataSource.id.organizationId}/${dataSource.id.directoryName}/${dataLayer.name}"
}

case class DataServiceMappingRequest(
    dataSource: DataSource,
    dataLayer: SegmentationLayer,
    mapping: String
)

case class MappingReadInstruction(
    baseDir: Path,
    dataSource: DataSource,
    mapping: String
)
