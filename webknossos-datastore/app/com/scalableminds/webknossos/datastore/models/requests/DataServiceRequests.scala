package com.scalableminds.webknossos.datastore.models.requests

import java.nio.file.Path

import com.scalableminds.util.geometry.{Point3D, Vector3I}
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, SegmentationLayer}

case class DataServiceRequestSettings(halfByte: Boolean,
                                      appliedAgglomerate: Option[String] = None,
                                      version: Option[Long] = None)

object DataServiceRequestSettings {
  val default = DataServiceRequestSettings(halfByte = false)
}

case class DataServiceDataRequest(
    dataSource: DataSource, // null in VolumeTracings
    dataLayer: DataLayer,
    dataLayerMapping: Option[String],
    cuboid: Cuboid,
    settings: DataServiceRequestSettings,
    voxelDimensions: Vector3I = Vector3I(1, 1, 1)
)

case class DataReadInstruction(
    baseDir: Path,
    dataSource: DataSource,
    dataLayer: DataLayer,
    bucket: BucketPosition,
    version: Option[Long] = None
) {
  val cube = bucket.toCube(dataLayer.lengthOfUnderlyingCubes(bucket.resolution))
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
