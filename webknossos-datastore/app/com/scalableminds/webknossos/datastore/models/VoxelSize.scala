package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.webknossos.datastore.models.LengthUnit.LengthUnit
import play.api.libs.json.{Format, JsResult, JsValue, Json}

// Defines the real-world size in a length unit for a mag1-voxel.
case class VoxelSize(factor: Vec3Double, unit: LengthUnit)

object VoxelSize {
  private val DEFAULT_UNIT: LengthUnit = LengthUnit.µm // TODO: final default should be nm

  def fromFactorWithDefaultUnit(factor: Vec3Double): VoxelSize = VoxelSize(factor, DEFAULT_UNIT)

  implicit val voxelSizeFormat: Format[VoxelSize] = new Format[VoxelSize] {
    def reads(json: JsValue): JsResult[VoxelSize] =
      Vec3Double.Vec3DoubleReads.reads(json).map(VoxelSize.fromFactorWithDefaultUnit).orElse {
        Json.reads[VoxelSize].reads(json)
      }

    def writes(voxelSize: VoxelSize): JsValue = Json.writes[VoxelSize].writes(voxelSize)
  }

}
