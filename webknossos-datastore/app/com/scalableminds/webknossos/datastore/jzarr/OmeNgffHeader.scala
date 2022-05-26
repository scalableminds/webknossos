package com.scalableminds.webknossos.datastore.jzarr;

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import play.api.libs.json.{Json, OFormat}

case class OmeNgffCoordinateTransformation(`type`: String = "scale", scale: List[Double])

object OmeNgffCoordinateTransformation {
  implicit val jsonFormat: OFormat[OmeNgffCoordinateTransformation] = Json.format[OmeNgffCoordinateTransformation]
}

case class OmeNgffDataset(path: String, coordinateTransformations: List[OmeNgffCoordinateTransformation])

object OmeNgffDataset {
  implicit val jsonFormat: OFormat[OmeNgffDataset] = Json.format[OmeNgffDataset]
}

case class OmeNgffAxis(name: String, `type`: String, unit: Option[String] = None)

object OmeNgffAxis {
  implicit val jsonFormat: OFormat[OmeNgffAxis] = Json.format[OmeNgffAxis]
}

case class OmeNgffOneHeader(
    version: String = "0.4", // format version number
    name: String,
    axes: List[OmeNgffAxis] = List(
      OmeNgffAxis(name = "c", `type` = "channel"),
      OmeNgffAxis(name = "x", `type` = "space", unit = Some("nanometer")),
      OmeNgffAxis(name = "y", `type` = "space", unit = Some("nanometer")),
      OmeNgffAxis(name = "z", `type` = "space", unit = Some("nanometer")),
    ),
    datasets: List[OmeNgffDataset]
)

object OmeNgffOneHeader {
  implicit val jsonFormat: OFormat[OmeNgffOneHeader] = Json.format[OmeNgffOneHeader]
}

case class OmeNgffHeader(multiscales: List[OmeNgffOneHeader])

object OmeNgffHeader {
  def createFromDataLayerName(dataLayerName: String,
                              dataSourceScale: Vec3Double,
                              mags: List[Vec3Int]): OmeNgffHeader = {
    val datasets = mags.map(
      mag =>
        OmeNgffDataset(
          path = mag.toMagLiteral(allowScalar = true),
          List(
            OmeNgffCoordinateTransformation(scale = List[Double](1.0) ++ (dataSourceScale * Vec3Double(mag)).toList))))
    OmeNgffHeader(multiscales = List(OmeNgffOneHeader(name = dataLayerName, datasets = datasets)))
  }

  implicit val jsonFormat: OFormat[OmeNgffHeader] = Json.format[OmeNgffHeader]
}
