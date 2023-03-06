package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.{ArrayOrder, Compressor, DatasetHeader, DimensionSeparator}
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import play.api.libs.json.{Format, JsResult, JsValue, Json}
import play.api.libs.json.Json.WithDefaultValues

import java.nio.ByteOrder

case class PrecomputedHeader(`type`: String, data_type: String, num_channels: Int, scales: List[PrecomputedScale]) {

  def getScale(key: String): Option[PrecomputedScale] =
    scales.find(s => s.key == key)

  def describesSegmentationLayer: Boolean = `type` == "segmentation"
}

case class PrecomputedScale(key: String,
                            size: Array[Int],
                            resolution: Array[Int],
                            chunk_sizes: Array[Array[Int]],
                            encoding: String,
                            voxel_offset: Option[Array[Int]],
                            compressed_segmentation_block_size: Option[Array[Int]],
                            sharding: Option[ShardingSpecification]) {

  // From the neuroglancer specification (https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/volume.md#info-json-file-specification)
  // > "chunk_sizes": Array of 3-element [x, y, z] arrays of integers specifying the x, y, and z dimensions in voxels of each supported chunk size. Typically just a single chunk size will be specified as [[x, y, z]].
  // While the format specifies that there can be multiple chunk sizes, we only support the first one.
  def primaryChunkSize: Array[Int] = chunk_sizes.head

}

case class PrecomputedScaleHeader(precomputedScale: PrecomputedScale, precomputedHeader: PrecomputedHeader)
    extends DatasetHeader {
  override def datasetShape: Array[Int] =
    precomputedScale.size

  override def chunkSize: Array[Int] = precomputedScale.chunk_sizes.head

  override def dimension_separator: DimensionSeparator = DimensionSeparator.UNDERSCORE

  override def dataType: String = precomputedHeader.data_type

  override def fill_value: Either[String, Number] = Right(0)

  override def order: ArrayOrder = ArrayOrder.F

  override lazy val byteOrder: ByteOrder = ByteOrder.LITTLE_ENDIAN

  override def resolvedDataType: ArrayDataType =
    PrecomputedDataType.toArrayDataType(PrecomputedDataType.fromString(dataType.toLowerCase).get)

  lazy val compressorImpl: Compressor = PrecomputedCompressorFactory.create(precomputedScale.encoding)

  override def chunkSizeAtIndex(chunkIndex: Array[Int]): Array[Int] =
    chunkIndexToNDimensionalBoundingBox(chunkIndex).map(dim => dim._2 - dim._1)

  lazy val voxelOffset: Array[Int] = precomputedScale.voxel_offset.getOrElse(Array(0, 0, 0))

  def chunkIndexToNDimensionalBoundingBox(chunkIndex: Array[Int]): Array[(Int, Int)] =
    chunkIndex.zipWithIndex.map(chunkIndexWithDim => {
      val (chunkIndexAtDim, dim) = chunkIndexWithDim
      val beginOffset = voxelOffset(dim) + chunkIndexAtDim * precomputedScale.primaryChunkSize(dim)
      val endOffset = voxelOffset(dim) + ((chunkIndexAtDim + 1) * precomputedScale.primaryChunkSize(dim))
        .min(precomputedScale.size(dim))
      (beginOffset, endOffset)
    })
}

case class ShardingSpecification(`@type`: String)

object ShardingSpecification extends JsonImplicits {
  implicit object ShardingSpecificationFormat extends Format[ShardingSpecification] {
    override def reads(json: JsValue): JsResult[ShardingSpecification] =
      Json.using[WithDefaultValues].reads[ShardingSpecification].reads(json)

    override def writes(shardingSpecification: ShardingSpecification): JsValue =
      Json.writes[ShardingSpecification].writes(shardingSpecification)
  }
}

object PrecomputedScale extends JsonImplicits {
  implicit object PrecomputedScaleFormat extends Format[PrecomputedScale] {
    override def reads(json: JsValue): JsResult[PrecomputedScale] =
      Json.using[WithDefaultValues].reads[PrecomputedScale].reads(json)

    override def writes(precomputedScale: PrecomputedScale): JsValue =
      Json.writes[PrecomputedScale].writes(precomputedScale)
  }
}

object PrecomputedHeader extends JsonImplicits {
  val FILENAME_INFO = "info"

  implicit object PrecomputedHeaderFormat extends Format[PrecomputedHeader] {
    override def reads(json: JsValue): JsResult[PrecomputedHeader] =
      Json.using[WithDefaultValues].reads[PrecomputedHeader].reads(json)

    override def writes(precomputedHeader: PrecomputedHeader): JsValue =
      Json.writes[PrecomputedHeader].writes(precomputedHeader)
  }
}
