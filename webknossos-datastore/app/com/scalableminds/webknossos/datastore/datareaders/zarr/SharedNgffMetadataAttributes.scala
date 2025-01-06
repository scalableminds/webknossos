package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.webknossos.datastore.models
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import net.liftweb.common.{Box, Failure, Full}
import play.api.libs.json.{Json, OFormat}

case class NgffCoordinateTransformation(`type`: String = "scale", scale: Option[List[Double]])

object NgffCoordinateTransformation {
  implicit val jsonFormat: OFormat[NgffCoordinateTransformation] = Json.format[NgffCoordinateTransformation]
}

case class NgffDataset(path: String, coordinateTransformations: List[NgffCoordinateTransformation])

object NgffDataset {
  implicit val jsonFormat: OFormat[NgffDataset] = Json.format[NgffDataset]
}

case class NgffAxis(name: String, `type`: String, unit: Option[String] = None, units: Option[String] = None) {

  def lengthUnit: Box[models.LengthUnit.Value] = {
    val u = units.orElse(unit)
    if (`type` != "space")
      Failure(f"Could not convert NGFF unit $name of type ${`type`} to LengthUnit")
    else {
      u match {
        case None | Some("") => Full(VoxelSize.DEFAULT_UNIT)
        case Some(someUnit)  => LengthUnit.fromString(someUnit)
      }
    }
  }
}

object NgffAxis {
  implicit val jsonFormat: OFormat[NgffAxis] = Json.format[NgffAxis]
}

case class NgffOmeroMetadata(channels: List[NgffChannelAttributes])
object NgffOmeroMetadata {
  implicit val jsonFormat: OFormat[NgffOmeroMetadata] = Json.format[NgffOmeroMetadata]
}

case class NgffChannelWindow(min: Double, max: Double, start: Double, end: Double)
object NgffChannelWindow {
  implicit val jsonFormat: OFormat[NgffChannelWindow] = Json.format[NgffChannelWindow]
}

case class NgffChannelAttributes(color: Option[String],
                                 label: Option[String],
                                 window: Option[NgffChannelWindow],
                                 inverted: Option[Boolean],
                                 active: Option[Boolean])
object NgffChannelAttributes {
  implicit val jsonFormat: OFormat[NgffChannelAttributes] = Json.format[NgffChannelAttributes]
}
