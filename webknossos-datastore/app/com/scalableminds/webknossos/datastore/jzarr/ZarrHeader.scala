package com.scalableminds.webknossos.datastore.jzarr

import java.nio.ByteOrder

import com.scalableminds.webknossos.datastore.jzarr.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType.ZarrDataType
import com.scalableminds.webknossos.datastore.jzarr.ucarutils.BytesConverter.bytesPerElementFor
import net.liftweb.common.Box.tryo
import play.api.libs.json._

import scala.collection.JavaConverters._

case class ZarrHeader(
    zarr_format: Int,
    shape: Array[Int], // shape of the entire array
    chunks: Array[Int], // shape of each chunk
    compressor: Option[JsObject] = None, // Option[Map[String, Either[Int, String]]],
    dimension_separator: Option[DimensionSeparator],
    dtype: String,
    fill_value: String,
    order: String = "C",
) {
  lazy val byteOrder: ByteOrder =
    if (dtype.startsWith(">")) ByteOrder.BIG_ENDIAN
    else if (dtype.startsWith("<")) ByteOrder.LITTLE_ENDIAN
    else if (dtype.startsWith("|")) ByteOrder.nativeOrder
    else ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compressor
      .map(c => CompressorFactory.create(c.asInstanceOf[Map[String, Object]].asJava))
      .getOrElse(CompressorFactory.nullCompressor)

  lazy val dataType: ZarrDataType =
    ZarrDataType.fromString(dtype.filter(char => char != '>' && char != '<' & char != '|')).get

  lazy val bytesPerChunk: Int = chunks.toList.product * bytesPerElementFor(dataType)

  lazy val fillValueNumber: Number = {
    // TODO: use fill value from string in .zarray
    dataType match {
      case ZarrDataType.f4 | ZarrDataType.f8 => 0.0
      case _                                 => 0
    }
  }
}

object ZarrHeader {
  val FILENAME_DOT_ZARRAY = ".zarray"

  implicit object numberFormat extends Format[Number] {

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

  implicit val jsonFormat: OFormat[ZarrHeader] = Json.format[ZarrHeader]
}
