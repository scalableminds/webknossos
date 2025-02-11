package com.scalableminds.webknossos.datastore.datareaders.zarr

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.datareaders.{
  ArrayDataType,
  ArrayOrder,
  CompressionSetting,
  Compressor,
  DatasetHeader,
  DimensionSeparator
}

import java.nio.ByteOrder
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json._

case class ZarrHeader(
    zarr_format: Int, // format version number
    shape: Array[Int], // shape of the entire array
    chunks: Array[Int], // shape of each chunk
    compressor: Option[Map[String, CompressionSetting]] = None, // specifies compressor to use, with parameters
    filters: Option[List[Map[String, String]]] = None, // specifies filters to use, with parameters
    override val dimension_separator: DimensionSeparator = DimensionSeparator.DOT,
    dtype: String,
    override val fill_value: Either[String, Number] = Right(0),
    override val order: ArrayOrder
) extends DatasetHeader {

  override lazy val datasetShape: Option[Array[Int]] = Some(shape)
  override lazy val chunkShape: Array[Int] = chunks

  override lazy val byteOrder: ByteOrder =
    if (dtype.startsWith(">")) ByteOrder.BIG_ENDIAN
    else if (dtype.startsWith("<")) ByteOrder.LITTLE_ENDIAN
    else if (dtype.startsWith("|")) ByteOrder.nativeOrder
    else ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compressor.map(ZarrCompressorFactory.create).getOrElse(ZarrCompressorFactory.nullCompressor)

  lazy val resolvedDataType: ArrayDataType =
    ArrayDataType.fromString(dtype.filter(char => char != '>' && char != '<' & char != '|')).get

  lazy val voxelOffset: Array[Int] = Array.fill(rank)(0)
}

object ZarrHeader extends JsonImplicits {
  val FILENAME_DOT_ZARRAY = ".zarray"

  /** * This function is used for exposing webknossos layers as zarr layers via the API. It therefore defaults to the
    * necessary defaults for webknossos data layers.
    */
  def fromLayer(dataLayer: DataLayer, mag: Vec3Int): ZarrHeader = {
    val cubeLength = DataLayer.bucketLength
    val (channels, dtype) = ElementClass.toChannelAndZarrString(dataLayer.elementClass)
    // data request method always decompresses before sending
    val compressor = None

    val additionalAxesShapeEntries =
      dataLayer.additionalAxes.map(axes => axes.map(_.bounds(1)).toArray).getOrElse(Array.empty[Int])
    val additionalAxesChunksEntries =
      dataLayer.additionalAxes.map(axes => axes.map(_ => 1).toArray).getOrElse(Array.empty[Int])

    val shape = Array(channels) ++ additionalAxesShapeEntries ++ Array(
      // Zarr can't handle data sets that don't start at 0, so we extend the shape to include "true" coords
      (dataLayer.boundingBox.width + dataLayer.boundingBox.topLeft.x) / mag.x,
      (dataLayer.boundingBox.height + dataLayer.boundingBox.topLeft.y) / mag.y,
      (dataLayer.boundingBox.depth + dataLayer.boundingBox.topLeft.z) / mag.z
    )

    val chunks = Array(channels) ++ additionalAxesChunksEntries ++ Array(cubeLength, cubeLength, cubeLength)

    ZarrHeader(
      zarr_format = 2,
      shape = shape,
      chunks = chunks,
      compressor = compressor,
      dtype = dtype,
      order = ArrayOrder.F
    )
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
