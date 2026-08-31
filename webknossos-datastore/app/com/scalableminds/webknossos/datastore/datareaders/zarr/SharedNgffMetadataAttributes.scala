package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.tools.AutoFormat
import com.scalableminds.webknossos.datastore.models
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}

case class NgffCoordinateTransformation(
    `type`: String = "scale",
    scale: Option[List[Double]],
    translation: Option[List[Double]]
) derives AutoFormat

case class NgffDataset(path: String, coordinateTransformations: List[NgffCoordinateTransformation]) derives AutoFormat

case class NgffAxis(name: String, `type`: String, unit: Option[String] = None) derives AutoFormat {

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

case class NgffOmeroMetadata(channels: List[NgffChannelAttributes]) derives AutoFormat

case class NgffChannelWindow(min: Double, max: Double, start: Double, end: Double) derives AutoFormat

case class NgffChannelAttributes(
    color: Option[String],
    label: Option[String],
    window: Option[NgffChannelWindow],
    inverted: Option[Boolean],
    active: Option[Boolean]
) derives AutoFormat
