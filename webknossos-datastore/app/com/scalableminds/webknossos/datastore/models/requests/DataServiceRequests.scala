package com.scalableminds.webknossos.datastore.models.requests

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition, CubePosition}
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
    dataLayerMapping: Option[String],
    cuboid: Cuboid,
    settings: DataServiceRequestSettings,
    subsamplingStrides: Vec3Int = Vec3Int.ones // if > 1, skip voxels when loading (used for adhoc mesh generation)
)

case class DataReadInstruction(
    baseDir: Path,
    dataSource: DataSource,
    dataLayer: DataLayer,
    bucket: BucketPosition,
    version: Option[Long] = None
) {
  val cube: CubePosition = bucket.toCube(dataLayer.lengthOfUnderlyingCubes(bucket.mag))
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
