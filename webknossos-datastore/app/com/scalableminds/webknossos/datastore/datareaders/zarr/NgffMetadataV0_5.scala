package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import play.api.libs.json.{Json, OFormat}

// See suggested changes to version v0.5 here together with an example: https://ngff.openmicroscopy.org/rfc/2/index.html#examples
case class NgffMultiscalesItemV0_5(
    // Ngff V0.5 no longer has the version inside the multiscale field.
    name: Option[String],
    axes: List[NgffAxis] = List(
      NgffAxis(name = "c", `type` = "channel"),
      NgffAxis(name = "x", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "y", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "z", `type` = "space", unit = Some("nanometer")),
    ),
    datasets: List[NgffDataset]
)

object NgffMultiscalesItemV0_5 {
  implicit val jsonFormat: OFormat[NgffMultiscalesItemV0_5] = Json.format[NgffMultiscalesItemV0_5]

  def asV0_4(multiscalesItemV0_5: NgffMultiscalesItemV0_5): NgffMultiscalesItem =
    NgffMultiscalesItem(
      version = "0.5",
      name = multiscalesItemV0_5.name,
      axes = multiscalesItemV0_5.axes,
      datasets = multiscalesItemV0_5.datasets
    )
}

case class NgffMetadataV0_5(version: String,
                            multiscales: List[NgffMultiscalesItemV0_5],
                            omero: Option[NgffOmeroMetadata])

object NgffMetadataV0_5 {
  def fromNameVoxelSizeAndMags(dataLayerName: String,
                               dataSourceVoxelSize: VoxelSize,
                               mags: List[Vec3Int],
                               additionalAxes: Option[Seq[AdditionalAxis]],
                               version: String = "0.5"): NgffMetadataV0_5 = {
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
    NgffMetadataV0_5(version,
                     multiscales =
                       List(NgffMultiscalesItemV0_5(name = Some(dataLayerName), datasets = datasets, axes = axes)),
                     None)
  }

  implicit val jsonFormat: OFormat[NgffMetadataV0_5] = Json.format[NgffMetadataV0_5]
}
