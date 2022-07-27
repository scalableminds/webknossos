package com.scalableminds.webknossos.datastore.jzarr;

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class OmeNgffCoordinateTransformation(`type`: String = "scale", scale: List[Double])

object OmeNgffCoordinateTransformation {
  implicit val jsonFormat: OFormat[OmeNgffCoordinateTransformation] = Json.format[OmeNgffCoordinateTransformation]
}

case class OmeNgffDataset(path: String, coordinateTransformations: List[OmeNgffCoordinateTransformation])

object OmeNgffDataset {
  implicit val jsonFormat: OFormat[OmeNgffDataset] = Json.format[OmeNgffDataset]
}

case class OmeNgffGroupHeader(zarr_format: Int)
object OmeNgffGroupHeader {
  implicit val jsonFormat: OFormat[OmeNgffGroupHeader] = Json.format[OmeNgffGroupHeader]
  val FILENAME_DOT_ZGROUP = ".zgroup"
}

case class OmeNgffAxis(name: String, `type`: String, unit: Option[String] = None) {

  def spaceUnitToNmFactor(implicit ec: ExecutionContext): Fox[Double] = {
    if (`type` != "space")
      return Fox.failure(s"unit-to-nanometer factor requested for non-space axis ($name, ${`type`})")
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

}

object OmeNgffAxis {
  implicit val jsonFormat: OFormat[OmeNgffAxis] = Json.format[OmeNgffAxis]
}

case class OmeNgffOneHeader(
    version: String = "0.4", // format version number
    name: Option[String],
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
  def fromDataLayerName(dataLayerName: String, dataSourceScale: Vec3Double, mags: List[Vec3Int]): OmeNgffHeader = {
    val datasets = mags.map(
      mag =>
        OmeNgffDataset(
          path = mag.toMagLiteral(allowScalar = true),
          List(
            OmeNgffCoordinateTransformation(scale = List[Double](1.0) ++ (dataSourceScale * Vec3Double(mag)).toList))))
    OmeNgffHeader(multiscales = List(OmeNgffOneHeader(name = Some(dataLayerName), datasets = datasets)))
  }

  implicit val jsonFormat: OFormat[OmeNgffHeader] = Json.format[OmeNgffHeader]

  val FILENAME_DOT_ZATTRS = ".zattrs"
}
