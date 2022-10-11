package com.scalableminds.webknossos.datastore.datareaders.zarr;

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class NgffCoordinateTransformation(`type`: String = "scale", scale: List[Double])

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

  def spaceUnitToNmFactor(implicit ec: ExecutionContext): Fox[Double] =
    if (`type` != "space")
      Fox.failure(s"unit-to-nanometer factor requested for non-space axis ($name, type=${`type`})")
    else
      unit.map(_.toLowerCase) match {
        case None               => Fox.successful(1.0)
        case Some("")           => Fox.successful(1.0)
        case Some("yoctometer") => Fox.successful(1e-15)
        case Some("zeptometer") => Fox.successful(1e-12)
        case Some("attometer")  => Fox.successful(1e-9)
        case Some("femtometer") => Fox.successful(1e-6)
        case Some("picometer")  => Fox.successful(1e-3)
        case Some("nanometer")  => Fox.successful(1.0)
        case Some("micrometer") => Fox.successful(1e3)
        case Some("millimeter") => Fox.successful(1e6)
        case Some("centimeter") => Fox.successful(1e7)
        case Some("decimeter")  => Fox.successful(1e8)
        case Some("meter")      => Fox.successful(1e9)
        case Some("hectometer") => Fox.successful(1e11)
        case Some("kilometer")  => Fox.successful(1e12)
        case Some("megameter")  => Fox.successful(1e15)
        case Some("gigameter")  => Fox.successful(1e18)
        case Some("terameter")  => Fox.successful(1e21)
        case Some("petameter")  => Fox.successful(1e24)
        case Some("exameter")   => Fox.successful(1e27)
        case Some("zettameter") => Fox.successful(1e30)
        case Some("yottameter") => Fox.successful(1e33)
        case Some("angstrom")   => Fox.successful(0.1)
        case Some("inch")       => Fox.successful(25400000.0)
        case Some("foot")       => Fox.successful(304800000.0)
        case Some("yard")       => Fox.successful(914400000.0)
        case Some("mile")       => Fox.successful(1609344000000.0)
        case Some("parsec")     => Fox.successful(3.085677581e25)
        case Some(unknownUnit)  => Fox.failure(s"Unknown space axis unit: $unknownUnit")
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

case class NgffMetadata(multiscales: List[NgffMultiscalesItem])

object NgffMetadata {
  def fromNameScaleAndMags(dataLayerName: String, dataSourceScale: Vec3Double, mags: List[Vec3Int]): NgffMetadata = {
    val datasets = mags.map(
      mag =>
        NgffDataset(
          path = mag.toMagLiteral(allowScalar = true),
          List(NgffCoordinateTransformation(scale = List[Double](1.0) ++ (dataSourceScale * Vec3Double(mag)).toList))))
    NgffMetadata(multiscales = List(NgffMultiscalesItem(name = Some(dataLayerName), datasets = datasets)))
  }

  implicit val jsonFormat: OFormat[NgffMetadata] = Json.format[NgffMetadata]

  val FILENAME_DOT_ZATTRS = ".zattrs"
}
