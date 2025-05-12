package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.ByteUtils
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.{ArrayOrder, Compressor, DatasetHeader, DimensionSeparator}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import play.api.libs.json.{Format, JsResult, JsValue, Json}
import play.api.libs.json.Json.WithDefaultValues

import java.nio.ByteOrder

case class PrecomputedHeader(`type`: String,
                             data_type: String,
                             num_channels: Int,
                             scales: List[PrecomputedScale],
                             mesh: Option[String]) {

  def getScale(key: String): Option[PrecomputedScale] =
    scales.find(s => s.key == key)

  def describesSegmentationLayer: Boolean = `type` == "segmentation"

  def meshPath: String = mesh.getOrElse("mesh")
}

case class PrecomputedScale(key: String,
                            size: Array[Int],
                            resolution: Array[Double],
                            chunk_sizes: Array[Array[Int]],
                            encoding: String,
                            voxel_offset: Option[Array[Int]],
                            compressed_segmentation_block_size: Option[Vec3Int],
                            sharding: Option[ShardingSpecification]) {

  // From the neuroglancer specification (https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/volume.md#info-json-file-specification)
  // > "chunk_sizes": Array of 3-element [x, y, z] arrays of integers specifying the x, y, and z dimensions in voxels of each supported chunk size. Typically just a single chunk size will be specified as [[x, y, z]].
  // While the format specifies that there can be multiple chunk sizes, we only support the first one.
  def primaryChunkShape: Array[Int] = chunk_sizes.head

}

case class PrecomputedScaleHeader(precomputedScale: PrecomputedScale, precomputedHeader: PrecomputedHeader)
    extends DatasetHeader {
  override def datasetShape: Option[Array[Int]] = Some(precomputedScale.size)

  override def chunkShape: Array[Int] = precomputedScale.chunk_sizes.head

  override def dimension_separator: DimensionSeparator = DimensionSeparator.UNDERSCORE

  override def fill_value: Either[String, Number] = Right(0)

  override def order: ArrayOrder = ArrayOrder.F

  override lazy val byteOrder: ByteOrder = ByteOrder.LITTLE_ENDIAN

  override def resolvedDataType: ArrayDataType =
    PrecomputedDataType.toArrayDataType(PrecomputedDataType.fromString(precomputedHeader.data_type.toLowerCase).get)

  lazy val compressorImpl: Compressor = PrecomputedCompressorFactory.create(this)

  override def chunkShapeAtIndex(chunkIndex: Array[Int]): Array[Int] =
    chunkIndexToNDimensionalBoundingBox(chunkIndex).map(dim => dim._2 - dim._1)

  override def voxelOffset: Array[Int] = precomputedScale.voxel_offset.getOrElse(Array(0, 0, 0))

  def chunkIndexToNDimensionalBoundingBox(chunkIndex: Array[Int]): Array[(Int, Int)] =
    chunkIndex.zipWithIndex.map(chunkIndexWithDim => {
      val (chunkIndexAtDim, dim) = chunkIndexWithDim
      val beginOffset = voxelOffset(dim) + chunkIndexAtDim * precomputedScale.primaryChunkShape(dim)
      val endOffset = voxelOffset(dim) + ((chunkIndexAtDim + 1) * precomputedScale.primaryChunkShape(dim))
        .min(precomputedScale.size(dim))
      (beginOffset, endOffset)
    })

  def gridSize: Array[Int] = chunkShape.zip(precomputedScale.size).map { case (c, s) => (s.toDouble / c).ceil.toInt }

  override def isSharded: Boolean = precomputedScale.sharding.isDefined
}

case class ShardingSpecification(`@type`: String,
                                 preshift_bits: Long,
                                 hash: String,
                                 minishard_bits: Int,
                                 shard_bits: Long,
                                 minishard_index_encoding: String = "raw",
                                 data_encoding: String = "raw")
    extends ByteUtils {

  def hashFunction(input: Long): Long =
    hash match {
      case "identity"            => input
      case "murmurhash3_x86_128" => MurmurHash3.hash64(longToBytes(input))
      case _                     => throw new IllegalArgumentException(s"Unsupported hash function: $hash")
    }

  private lazy val minishardMask = {
    if (minishard_bits == 0) {
      0
    } else {
      var minishardMask = 1L
      for (_ <- 0 until minishard_bits - 1) {
        minishardMask <<= 1
        minishardMask |= 1
      }
      minishardMask
    }
  }

  private lazy val shardMask = {
    val oneMask = 0xFFFFFFFFFFFFFFFFL
    val cursor = minishard_bits + shard_bits
    val shardMask = ~((oneMask >> cursor) << cursor)
    shardMask & (~minishardMask)
  }

  def getMinishardInfo(chunkHash: Long): (Long, Long) = {
    val rawChunkIdentifier = chunkHash >> preshift_bits
    val chunkIdentifier = hashFunction(rawChunkIdentifier)
    val minishardNumber = chunkIdentifier & minishardMask
    val shardNumber = (chunkIdentifier & shardMask) >> minishard_bits
    (shardNumber, minishardNumber)
  }

  def getPathForShard(base: VaultPath, shardNumber: Long): VaultPath =
    if (shard_bits == 0) {
      base / "0.shard"
    } else {
      val shardString =
        String.format(s"%1$$${(shard_bits.toFloat / 4).ceil.toInt}s", shardNumber.toHexString).replace(' ', '0')
      base / s"$shardString.shard"
    }

}

object ShardingSpecification extends JsonImplicits {
  implicit object ShardingSpecificationFormat extends Format[ShardingSpecification] {
    override def reads(json: JsValue): JsResult[ShardingSpecification] =
      Json.using[WithDefaultValues].reads[ShardingSpecification].reads(json)

    override def writes(shardingSpecification: ShardingSpecification): JsValue =
      Json.writes[ShardingSpecification].writes(shardingSpecification)
  }

  def empty: ShardingSpecification = ShardingSpecification("neuroglancer_uint64_sharded_v1", 0, "identity", 0, 0)
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
