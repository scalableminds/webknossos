package com.scalableminds.webknossos.datastore.n5

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.jzarr.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.jzarr.BytesConverter.bytesPerElementFor
import com.scalableminds.webknossos.datastore.jzarr.{ArrayOrder, AxisOrder, DimensionSeparator, ZarrDataType}
import com.scalableminds.webknossos.datastore.jzarr.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType.ZarrDataType
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.n5.N5DataType.N5DataType
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json._

import java.nio.ByteOrder

case class N5BlockHeader(blockSize: Array[Int], numElements: Int)

object N5BlockHeader {
  implicit val jsonFormat: OFormat[N5BlockHeader] = Json.format[N5BlockHeader]
}
case class N5Header(
                     //    zarr_format: Int, // format version number
                     dimensions: Array[Int], // shape of the entire array
                     blockSize: Array[Int], // shape of each chunk
                     compression: Option[Map[String, Either[String, Int]]] = None, // specifies compressor to use, with parameters
//                     filters: Option[List[Map[String, String]]] = None, // specifies filters to use, with parameters
//                     transform: Option[List[Map[String, String]]] = None,
                     dimension_separator: DimensionSeparator = DimensionSeparator.SLASH,
                     dataType: String,
                     // is always 0
                     fill_value: Either[String, Number] = Right(0),
                     // is always this
                     order: ArrayOrder = ArrayOrder.F
) {

  lazy val byteOrder: ByteOrder = ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compression.map(CompressorFactory.create).getOrElse(CompressorFactory.nullCompressor)

  lazy val resolvedDataType: ZarrDataType =
    N5DataType.toZarrDataType(N5DataType.fromString(dataType).get)

  lazy val bytesPerChunk: Int = blockSize.toList.product * bytesPerElementFor(resolvedDataType)

  lazy val fillValueNumber: Number =
    fill_value match {
      case Right(n) => n
      case Left(_)  => 0 // parsing fill value from string not currently supported
    }

  lazy val chunkShapeOrdered: Array[Int] =
    if (order == ArrayOrder.C) {
      blockSize
    } else blockSize.reverse

  lazy val elementClass: Option[ElementClass.Value] = ElementClass.guessFromZarrString(dataType)

  def boundingBox(axisOrder: AxisOrder): Option[BoundingBox] =
    if (Math.max(Math.max(axisOrder.x, axisOrder.y), axisOrder.z) >= rank)
      None
    else
      Some(BoundingBox(Vec3Int.zeros, dimensions(axisOrder.x), dimensions(axisOrder.y), dimensions(axisOrder.z)))

  lazy val rank: Int = dimensions.length

}

object N5Header {
  val FILENAME_DOT_ZARRAY = "attributes.json"

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

  implicit object ZarrHeaderFormat extends Format[N5Header] {
    override def reads(json: JsValue): JsResult[N5Header] =
      Json.using[WithDefaultValues].reads[N5Header].reads(json)

    override def writes(zarrheader: N5Header): JsValue =
      Json.writes[N5Header].writes(zarrheader)
//    override def writes(zarrHeader: N5Header): JsValue =
//      Json.obj(
//        "dtype" -> zarrHeader.dtype,
//        "fill_value" -> 0,
//        "zarr_format" -> zarrHeader.zarr_format,
//        "order" -> zarrHeader.order,
//        "chunks" -> zarrHeader.chunks,
//        "compressor" -> zarrHeader.compressor,
//        "filters" -> None,
//        "shape" -> zarrHeader.shape,
//        "dimension_seperator" -> zarrHeader.dimension_separator
//      )
  }
}
