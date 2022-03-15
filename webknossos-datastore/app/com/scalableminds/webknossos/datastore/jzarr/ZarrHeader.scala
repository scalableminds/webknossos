package com.scalableminds.webknossos.datastore.jzarr

import java.nio.ByteOrder

import com.scalableminds.webknossos.datastore.jzarr.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType.ZarrDataType
import BytesConverter.bytesPerElementFor
import net.liftweb.common.Box.tryo
import play.api.libs.json._

import scala.collection.JavaConverters._

case class ZarrHeader(
    zarr_format: Int,
    shape: Array[Int], // shape of the entire array
    chunks: Array[Int], // shape of each chunk
    compressor: Option[Map[String, Either[String, Number]]] = None,
    dimension_separator: DimensionSeparator = DimensionSeparator.DOT,
    dtype: String,
    fill_value: Either[String, Number] = Right(0),
    order: String = "C",
) {
  lazy val byteOrder: ByteOrder =
    if (dtype.startsWith(">")) ByteOrder.BIG_ENDIAN
    else if (dtype.startsWith("<")) ByteOrder.LITTLE_ENDIAN
    else if (dtype.startsWith("|")) ByteOrder.nativeOrder
    else ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compressor
      .map(c => CompressorFactory.create(mapCompressorParameters(c).asJava))
      .getOrElse(CompressorFactory.nullCompressor)

  lazy val dataType: ZarrDataType =
    ZarrDataType.fromString(dtype.filter(char => char != '>' && char != '<' & char != '|')).get

  lazy val bytesPerChunk: Int = chunks.toList.product * bytesPerElementFor(dataType)

  def mapCompressorParameters(compresor: Map[String, Either[String, Number]]): Map[String, Object] =
    compresor.mapValues {
      case Left(s)  => s.asInstanceOf[Object]
      case Right(n) => n.asInstanceOf[Object]
    }

  lazy val fillValueNumber: Number = {
    fill_value match {
      case Right(n) => n
      case Left(_)  => 0 // TODO: parse fill value from string
    }
  }

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
