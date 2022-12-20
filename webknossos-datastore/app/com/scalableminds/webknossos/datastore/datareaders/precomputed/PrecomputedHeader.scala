package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.{Compressor, DatasetHeader}
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import play.api.libs.json.{Format, JsResult, JsValue, Json}
import play.api.libs.json.Json.WithDefaultValues

import java.nio.ByteOrder

case class PrecomputedHeader(`type`: String, data_type: String, num_channels: Int, scales: List[PrecomputedScale])
    extends DatasetHeader {
  override def datasetShape: Array[Int] = (scales.head.resolution, scales.head.size).zipped.map(_ * _)

  override def chunkSize: Array[Int] = scales.head.chunk_sizes.head

  override def dimension_separator: DimensionSeparator = ???

  override def dataType: String = data_type

  override def fill_value: Either[String, Number] = ???

  override def order: ArrayOrder = ???

  override lazy val byteOrder: ByteOrder = ByteOrder.LITTLE_ENDIAN

  lazy val resolvedDataType: ArrayDataType =
    PrecomputedDataType.toArrayDataType(PrecomputedDataType.fromString(dataType.toLowerCase).get)

  override def compressorImpl: Compressor = ???
}

object PrecomputedHeader extends JsonImplicits {
  val METADATA_PATH = "%2Finfo" // TODO: Why doesn't "/" work?

  implicit object N5HeaderFormat extends Format[PrecomputedHeader] {
    override def reads(json: JsValue): JsResult[PrecomputedHeader] =
      Json.using[WithDefaultValues].reads[PrecomputedHeader].reads(json)

    override def writes(precomputedHeader: PrecomputedHeader): JsValue =
      Json.writes[PrecomputedHeader].writes(precomputedHeader)
  }
}

case class PrecomputedScale(key: String,
                            size: Array[Int],
                            resolution: Array[Int],
                            chunk_sizes: Array[Array[Int]],
                            voxel_offset: Option[Array[Int]])
//compressed_segmentation_block_size, sharding)
