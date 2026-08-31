package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.tools.AutoJsonFormat
import com.scalableminds.webknossos.datastore.models
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}

case class NgffCoordinateTransformation(
    `type`: String = "scale",
    scale: Option[List[Double]],
    translation: Option[List[Double]]
) derives AutoJsonFormat

case class NgffDataset(path: String, coordinateTransformations: List[NgffCoordinateTransformation])
    derives AutoJsonFormat

case class NgffAxis(name: String, `type`: String, unit: Option[String] = None) derives AutoJsonFormat {

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

case class NgffOmeroMetadata(channels: List[NgffChannelAttributes]) derives AutoJsonFormat

case class NgffChannelWindow(min: Double, max: Double, start: Double, end: Double) derives AutoJsonFormat

case class NgffChannelAttributes(
    color: Option[String],
    label: Option[String],
    window: Option[NgffChannelWindow],
    inverted: Option[Boolean],
    active: Option[Boolean]
) derives AutoJsonFormat
