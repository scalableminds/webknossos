package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.AutoJsonFormat
import com.scalableminds.webknossos.datastore.models.VoxelSize

case class NgffGroupHeader(zarr_format: Int) derives AutoJsonFormat
object NgffGroupHeader {
  val FILENAME_DOT_ZGROUP = ".zgroup"
}

case class NgffMultiscalesItem(
    version: String = "0.4", // format version number
    name: Option[String],
    axes: List[NgffAxis] = List(
      NgffAxis(name = "c", `type` = "channel"),
      NgffAxis(name = "x", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "y", `type` = "space", unit = Some("nanometer")),
      NgffAxis(name = "z", `type` = "space", unit = Some("nanometer"))
    ),
    datasets: List[NgffDataset]
) derives AutoJsonFormat

case class NgffMetadata(multiscales: List[NgffMultiscalesItem], omero: Option[NgffOmeroMetadata]) derives AutoJsonFormat

object NgffMetadata {
  def fromNameVoxelSizeAndMags(
      dataLayerName: String,
      dataSourceVoxelSize: VoxelSize,
      mags: Seq[Vec3Int]
  ): NgffMetadata = {
    val datasets = mags.map(mag =>
      NgffDataset(
        path = mag.toMagLiteral(allowScalar = true),
        List(
          NgffCoordinateTransformation(
            scale = Some(List[Double](1.0) ++ (dataSourceVoxelSize.factor * Vec3Double(mag)).toList),
            translation = None
          )
        )
      )
    )
    val lengthUnitStr = dataSourceVoxelSize.unit.toString
    val axes = List(
      NgffAxis(name = "c", `type` = "channel"),
      NgffAxis(name = "x", `type` = "space", unit = Some(lengthUnitStr)),
      NgffAxis(name = "y", `type` = "space", unit = Some(lengthUnitStr)),
      NgffAxis(name = "z", `type` = "space", unit = Some(lengthUnitStr))
    )
    NgffMetadata(
      multiscales = List(NgffMultiscalesItem(name = Some(dataLayerName), datasets = datasets.toList, axes = axes)),
      None
    )
  }

  val FILENAME_DOT_ZATTRS = ".zattrs"
}

case class NgffLabelsGroup(labels: List[String]) derives AutoJsonFormat

object NgffLabelsGroup {
  val LABEL_PATH = "labels/.zattrs"
}
