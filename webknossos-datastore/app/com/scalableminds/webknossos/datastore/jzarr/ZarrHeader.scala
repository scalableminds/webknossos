package com.scalableminds.webknossos.datastore.jzarr

import java.nio.ByteOrder

import com.scalableminds.webknossos.datastore.jzarr.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.jzarr.BytesConverter.bytesPerElementFor
import com.scalableminds.webknossos.datastore.jzarr.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType.ZarrDataType
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import net.liftweb.common.Box.tryo
import play.api.libs.json._

case class ZarrHeader(
    zarr_format: Int, // format version number
    shape: Array[Int], // shape of the entire array
    chunks: Array[Int], // shape of each chunk
    compressor: Option[Map[String, Either[String, Int]]] = None, // specifies compressor to use, with parameters
    filters: Option[List[Map[String, String]]] = None, // specifies filters to use, with parameters
    dimension_separator: DimensionSeparator = DimensionSeparator.DOT,
    dtype: String,
    fill_value: Either[String, Number] = Right(0),
    order: ArrayOrder
) {

  lazy val byteOrder: ByteOrder =
    if (dtype.startsWith(">")) ByteOrder.BIG_ENDIAN
    else if (dtype.startsWith("<")) ByteOrder.LITTLE_ENDIAN
    else if (dtype.startsWith("|")) ByteOrder.nativeOrder
    else ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compressor.map(CompressorFactory.create).getOrElse(CompressorFactory.nullCompressor)

  lazy val dataType: ZarrDataType =
    ZarrDataType.fromString(dtype.filter(char => char != '>' && char != '<' & char != '|')).get

  lazy val bytesPerChunk: Int = chunks.toList.product * bytesPerElementFor(dataType)

  lazy val fillValueNumber: Number =
    fill_value match {
      case Right(n) => n
      case Left(_)  => 0 // parsing fill value from string not currently supported
    }

  lazy val chunkShapeOrdered: Array[Int] =
    if (order == ArrayOrder.C) {
      chunks
    } else chunks.reverse

  lazy val elementClass: Option[ElementClass.Value] = ElementClass.guessFromZarrString(dtype)

}

object ZarrHeader {
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
