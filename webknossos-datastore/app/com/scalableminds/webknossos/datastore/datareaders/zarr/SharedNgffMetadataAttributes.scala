package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.models
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}

case class NgffCoordinateTransformation(
    `type`: String = "scale",
    scale: Option[List[Double]],
    translation: Option[List[Double]]
) derives JsonAutoFormat

case class NgffDataset(path: String, coordinateTransformations: List[NgffCoordinateTransformation])
    derives JsonAutoFormat

case class NgffAxis(name: String, `type`: String, unit: Option[String] = None) derives JsonAutoFormat {

  def lengthUnit: Box[models.LengthUnit.Value] =
    if (`type` != "space")
      Failure(f"Could not convert NGFF unit $name of type ${`type`} to LengthUnit")
    else {
      unit match {
        case None | Some("") => Full(VoxelSize.DEFAULT_UNIT)
        case Some(someUnit)  => Box.fromOption(LengthUnit.fromString(someUnit))
      }
    }
}

case class NgffOmeroMetadata(channels: List[NgffChannelAttributes]) derives JsonAutoFormat

case class NgffChannelWindow(min: Double, max: Double, start: Double, end: Double) derives JsonAutoFormat

case class NgffChannelAttributes(
    color: Option[String],
    label: Option[String],
    window: Option[NgffChannelWindow],
    inverted: Option[Boolean],
    active: Option[Boolean]
) derives JsonAutoFormat
