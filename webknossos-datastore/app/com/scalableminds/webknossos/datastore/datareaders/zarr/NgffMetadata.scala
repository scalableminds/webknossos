package com.scalableminds.webknossos.datastore.datareaders.zarr;

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.models
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
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

case class NgffGroupHeader(zarr_format: Int)
object NgffGroupHeader {
  implicit val jsonFormat: OFormat[NgffGroupHeader] = Json.format[NgffGroupHeader]
  val FILENAME_DOT_ZGROUP = ".zgroup"
}

case class NgffAxis(name: String, `type`: String, unit: Option[String] = None) {

  def lengthUnit: Box[models.LengthUnit.Value] =
    if (`type` != "space")
      Failure(f"Could not convert NGFF unit $name of type ${`type`} to LengthUnit")
    else {
      unit match {
        case None | Some("") => Full(VoxelSize.DEFAULT_UNIT)
        case Some(someUnit)  => LengthUnit.fromString(someUnit)
      }
    }
}

object NgffAxis {
  implicit val jsonFormat: OFormat[NgffAxis] = Json.format[NgffAxis]
}

case class NgffMultiscalesItem(
    version: String = "0.4", // format version number
    name: Option[String],
    axes: List[NgffAxis] = List(
      NgffAxis(name = "c", `type` = "channel"),
      NgffAxis(name = "x", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "y", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "z", `type` = "space", unit = Some("nanometer")),
    ),
    datasets: List[NgffDataset]
)

object NgffMultiscalesItem {
  implicit val jsonFormat: OFormat[NgffMultiscalesItem] = Json.format[NgffMultiscalesItem]
}

case class NgffMultiscalesItemV2(
    // Ngff V2 no longer has the version inside the multiscale field.
    name: Option[String],
    axes: List[NgffAxis] = List(
      NgffAxis(name = "c", `type` = "channel"),
      NgffAxis(name = "x", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "y", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "z", `type` = "space", unit = Some("nanometer")),
    ),
    datasets: List[NgffDataset]
)

object NgffMultiscalesItemV2 {
  implicit val jsonFormat: OFormat[NgffMultiscalesItemV2] = Json.format[NgffMultiscalesItemV2]
}

case class NgffMetadata(multiscales: List[NgffMultiscalesItem], omero: Option[NgffOmeroMetadata])

object NgffMetadata {
  def fromNameVoxelSizeAndMags(dataLayerName: String,
                               dataSourceVoxelSize: VoxelSize,
                               mags: List[Vec3Int]): NgffMetadata = {
    val datasets = mags.map(
      mag =>
        NgffDataset(
          path = mag.toMagLiteral(allowScalar = true),
          List(NgffCoordinateTransformation(
            scale = Some(List[Double](1.0) ++ (dataSourceVoxelSize.factor * Vec3Double(mag)).toList)))
      ))
    val lengthUnitStr = dataSourceVoxelSize.unit.toString
    val axes = List(
      NgffAxis(name = "c", `type` = "channel"),
      NgffAxis(name = "x", `type` = "space", unit = Some(lengthUnitStr)),
      NgffAxis(name = "y", `type` = "space", unit = Some(lengthUnitStr)),
      NgffAxis(name = "z", `type` = "space", unit = Some(lengthUnitStr)),
    )
    NgffMetadata(multiscales = List(NgffMultiscalesItem(name = Some(dataLayerName), datasets = datasets, axes = axes)),
                 None)
  }

  implicit val jsonFormat: OFormat[NgffMetadata] = Json.format[NgffMetadata]

  val FILENAME_DOT_ZATTRS = ".zattrs"
}

case class NgffMetadataV2(version: String, multiscales: List[NgffMultiscalesItemV2], omero: Option[NgffOmeroMetadata])

object NgffMetadataV2 {
  def fromNameVoxelSizeAndMags(dataLayerName: String,
                               dataSourceVoxelSize: VoxelSize,
                               mags: List[Vec3Int],
                               additionalAxes: Option[Seq[AdditionalAxis]],
                               version: String = "0.5"): NgffMetadataV2 = {
    val datasets = mags.map(
      mag =>
        NgffDataset(
          path = mag.toMagLiteral(allowScalar = true),
          List(NgffCoordinateTransformation(
            scale = Some(List[Double](1.0) ++ (dataSourceVoxelSize.factor * Vec3Double(mag)).toList)))
      ))
    val lengthUnitStr = dataSourceVoxelSize.unit.toString
    val axes = List(NgffAxis(name = "c", `type` = "channel")) ++ additionalAxes
      .getOrElse(List.empty)
      .zipWithIndex
      .map(axisAndIndex => NgffAxis(name = s"t${axisAndIndex._2}", `type` = "space", unit = Some(lengthUnitStr))) ++ List(
      NgffAxis(name = "x", `type` = "space", unit = Some(lengthUnitStr)),
      NgffAxis(name = "y", `type` = "space", unit = Some(lengthUnitStr)),
      NgffAxis(name = "z", `type` = "space", unit = Some(lengthUnitStr)),
    )
    NgffMetadataV2(version,
                   multiscales =
                     List(NgffMultiscalesItemV2(name = Some(dataLayerName), datasets = datasets, axes = axes)),
                   None)
  }

  implicit val jsonFormat: OFormat[NgffMetadataV2] = Json.format[NgffMetadataV2]
}

case class NgffLabelsGroup(labels: List[String])

object NgffLabelsGroup {
  implicit val jsonFormat: OFormat[NgffLabelsGroup] = Json.format[NgffLabelsGroup]
  val LABEL_PATH = "labels/.zattrs"
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
