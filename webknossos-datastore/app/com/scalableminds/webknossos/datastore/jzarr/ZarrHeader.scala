package com.scalableminds.webknossos.datastore.jzarr

import java.nio.ByteOrder

import com.scalableminds.webknossos.datastore.jzarr.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.jzarr.ucarutils.BytesConverter.bytesPerElementFor
import play.api.libs.json.{JsObject, Json, OFormat}

import scala.collection.JavaConverters._

case class ZarrHeader(
    zarr_format: Int,
    shape: Array[Int], // shape of the entire array
    chunks: Array[Int], // shape of each chunk
    compressor: Option[Map[String, Either[Int, String]]],
    dimension_separator: DimensionSeparator = DimensionSeparator.DOT,
    dtype: String,
    fill_value: Number,
    order: String = "C",
    filters: Option[JsObject] = None,
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

  lazy val dataType: DataType = DataType.valueOf(dtype.filter(char => char != '>' && char != '<' & char != '|'))

  lazy val bytesPerChunk: Int = chunks.toList.product * bytesPerElementFor(dataType)
}

object ZarrHeader {
  implicit val jsonFormat: OFormat[ZarrHeader] = Json.format[ZarrHeader]
}
