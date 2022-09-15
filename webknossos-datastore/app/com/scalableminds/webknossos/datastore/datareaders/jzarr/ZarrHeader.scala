package com.scalableminds.webknossos.datastore.datareaders.jzarr

import com.scalableminds.util.geometry.{Vec3Int}
import com.scalableminds.webknossos.datastore.datareaders.{ArrayOrder, Compressor, DatasetHeader, DimensionSeparator}

import java.nio.ByteOrder
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.jzarr.ZarrDataType.ZarrDataType
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json._

case class ZarrHeader(
    zarr_format: Int, // format version number
    shape: Array[Int], // shape of the entire array
    chunks: Array[Int], // shape of each chunk
    compressor: Option[Map[String, Either[String, Int]]] = None, // specifies compressor to use, with parameters
    filters: Option[List[Map[String, String]]] = None, // specifies filters to use, with parameters
    override val dimension_separator: DimensionSeparator = DimensionSeparator.DOT,
    dtype: String,
    override val fill_value: Either[String, Number] = Right(0),
    override val order: ArrayOrder
) extends DatasetHeader {

  lazy val datasetShape: Array[Int] = shape
  lazy val chunkSize: Array[Int] = chunks
  lazy val dataType: String = dtype

  override lazy val byteOrder: ByteOrder =
    if (dtype.startsWith(">")) ByteOrder.BIG_ENDIAN
    else if (dtype.startsWith("<")) ByteOrder.LITTLE_ENDIAN
    else if (dtype.startsWith("|")) ByteOrder.nativeOrder
    else ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compressor.map(CompressorFactoryZarr.create).getOrElse(CompressorFactoryZarr.nullCompressor)

  lazy val resolvedDataType: ZarrDataType =
    ZarrDataType.fromString(dtype.filter(char => char != '>' && char != '<' & char != '|')).get

  lazy val elementClass: Option[ElementClass.Value] = ElementClass.guessFromZarrString(dtype)
}

object ZarrHeader {
  val FILENAME_DOT_ZARRAY = ".zarray"

  /***
    * This function is used for exposing webknossos layers as zarr layers via the API.
    * It therefore defaults to the necessary defaults for webknossos data layers.
    */
  def fromLayer(dataLayer: DataLayer, mag: Vec3Int): ZarrHeader = {
    val cubeLength = DataLayer.bucketLength
    val (channels, dtype) = ElementClass.toChannelAndZarrString(dataLayer.elementClass)
    // data request method always decompresses before sending
    val compressor = None

    val shape = Array(
      channels,
      // Zarr can't handle data sets that don't start at 0, so we extend shape to include "true" coords
      (dataLayer.boundingBox.width + dataLayer.boundingBox.topLeft.x) / mag.x,
      (dataLayer.boundingBox.height + dataLayer.boundingBox.topLeft.y) / mag.y,
      (dataLayer.boundingBox.depth + dataLayer.boundingBox.topLeft.z) / mag.z
    )

    val chunks = Array(channels, cubeLength, cubeLength, cubeLength)

    ZarrHeader(zarr_format = 2,
               shape = shape,
               chunks = chunks,
               compressor = compressor,
               dtype = dtype,
               order = ArrayOrder.F)
  }

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

  implicit object ZarrHeaderFormat extends Format[ZarrHeader] {
    override def reads(json: JsValue): JsResult[ZarrHeader] =
      Json.using[WithDefaultValues].reads[ZarrHeader].reads(json)

    override def writes(zarrHeader: ZarrHeader): JsValue =
      Json.obj(
        "dtype" -> zarrHeader.dtype,
        "fill_value" -> 0,
        "zarr_format" -> zarrHeader.zarr_format,
        "order" -> zarrHeader.order,
        "chunks" -> zarrHeader.chunks,
        "compressor" -> zarrHeader.compressor,
        "filters" -> None,
        "shape" -> zarrHeader.shape,
        "dimension_seperator" -> zarrHeader.dimension_separator
      )
  }
}
