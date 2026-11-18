package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.models
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis

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

object NgffAxis {
  // Additional axes sit between the channel and the xyz axes of streamed arrays. They get their real names (matching the
  // zarr dimension_names) and a custom type, since NGFF allows at most three space axes and requires time axes to come
  // before the channel axis.
  private val additionalAxisType = "custom"

  def forAdditionalAxes(additionalAxes: Option[Seq[AdditionalAxis]]): List[NgffAxis] =
    additionalAxes
      .getOrElse(Seq.empty)
      .sortBy(_.index)
      .map(axis => NgffAxis(name = axis.name, `type` = additionalAxisType))
      .toList
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
