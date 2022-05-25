package com.scalableminds.webknossos.datastore.jzarr;

import java.io.IOException
import java.nio.ByteOrder
import java.nio.file.Path
import java.util
import akka.http.caching.LfuCache
import akka.http.caching.scaladsl.{Cache, CachingSettings}
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{Format, JsError, JsNumber, JsResult, JsSuccess, JsValue, Json, OFormat}
import ucar.ma2.{InvalidRangeException, Array => MultiArray}

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.io.Source

//dataSets = existingMags.map(
//mag =>
//Map(
//"path" -> mag,
//"coordinateTranformations" -> List(
//Map("type" -> "scale", "scale" -> dataSource.scale * Vec3Double(mag))
//)
//))
//header = Map(
//"multiscales" -> List(
//Map(
//"version" -> "0.4",
//"name" -> dataLayerName,
//"axes" -> List(
//Map("name" -> "c", "type" -> "channel"),
//Map("name" -> "x", "type" -> "space", "unit" -> "nanometer"),
//Map("name" -> "y", "type" -> "space", "unit" -> "nanometer"),
//Map("name" -> "z", "type" -> "space", "unit" -> "nanometer")
//),
//"datasets" -> dataSets
//)
//))

case class OmeNgffCoordinateTransformation(
    type: String,
    scale: Optional[Vec3Double]) {}

case class OmeNgffDataset(
    path: String,
    coordinateTranformations: List[OmeNgffCoordinateTransformation],
                         ) {}

case class OmeNgffHeader(
                       zarr_format: Int, // format version number
                       shape: Array[Int], // shape of the entire array
                       chunks: Array[Int], // shape of each chunk
                       compressor: Option[Map[String, Either[String, Int]]] = None, // specifies compressor to use, with parameters
                       filters: Option[List[Map[String, String]]] = None, // specifies filters to use, with parameters
                       dtype: String,
                       fill_value: Either[String, Number] = Right(0),
                     ) {

  lazy val byteOrder: ByteOrder =
    if (dtype.startsWith(">")) ByteOrder.BIG_ENDIAN
    else if (dtype.startsWith("<")) ByteOrder.LITTLE_ENDIAN
    else if (dtype.startsWith("|")) ByteOrder.nativeOrder
    else ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compressor.map(CompressorFactory.create).getOrElse(CompressorFactory.nullCompressor)

  lazy val fillValueNumber: Number =
    fill_value match {
      case Right(n) => n
      case Left(_)  => 0 // parsing fill value from string not currently supported
    }

}

object OmeNgffHeader {
  val FILENAME_DOT_ZARRAY = ".zarray"

  implicit object NumberFormat extends Format[Number] {

    override def reads(json: JsValue): JsResult[Number] =
      json
        .validate[Long]
        .map(_.asInstanceOf[Number])
        .orElse(json.validate[Float].map(_.asInstanceOf[Number]))
        .orElse(json.validate[Double].map(_.asInstanceOf[Number]))

    override def writes(number: Number): JsValue =
      tryo(number.longValue())
        .map(JsNumber(_))
        .orElse(tryo(number.floatValue()).map(JsNumber(_)))
        .getOrElse(JsNumber(number.doubleValue()))
  }

  implicit object StringOrIntFormat extends Format[Either[String, Int]] {

    override def reads(json: JsValue): JsResult[Either[String, Int]] =
      json.validate[String].map(Left(_)).orElse(json.validate[Int].map(Right(_)))

    override def writes(stringOrInt: Either[String, Int]): JsValue =
      stringOrInt match {
        case Left(s)  => Json.toJson(s)
        case Right(n) => Json.toJson(n)
      }
  }

  implicit object StringOrNumberFormat extends Format[Either[String, Number]] {

    override def reads(json: JsValue): JsResult[Either[String, Number]] =
      json.validate[String].map(Left(_)).orElse(json.validate[Number].map(Right(_)))

    override def writes(stringOrNumber: Either[String, Number]): JsValue =
      stringOrNumber match {
        case Left(s)  => Json.toJson(s)
        case Right(n) => Json.toJson(n)
      }
  }

  implicit val jsonFormat: OFormat[ZarrHeader] = Json.using[Json.WithDefaultValues].format[ZarrHeader]
}
