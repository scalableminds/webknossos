package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.datareaders.{ArrayDataType, ArrayOrder, DimensionSeparator}
import com.scalableminds.webknossos.datastore.datareaders.precomputed.{
  PrecomputedHeader,
  PrecomputedScale,
  PrecomputedScaleHeader,
  ShardingSpecification
}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import org.scalatest.wordspec.AsyncWordSpec

import java.nio.ByteOrder

class PrecomputedHeaderTestSuite extends AsyncWordSpec {

  private def parseHeader(json: String): PrecomputedHeader =
    JsonHelper.parseAs[PrecomputedHeader](json).get("test execution")

  private def parseScale(json: String): PrecomputedScale =
    JsonHelper.parseAs[PrecomputedScale](json).get("test execution")

  private def parseSharding(json: String): ShardingSpecification =
    JsonHelper.parseAs[ShardingSpecification](json).get("test execution")

  // Field names and value shapes follow the neuroglancer precomputed volume spec
  // (https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/volume.md),
  // laid out like the info files of the public precomputed EM volumes.
  private val imageInfoJson = """{
    "type": "image",
    "data_type": "uint8",
    "num_channels": 1,
    "scales": [
      {
        "key": "8_8_8",
        "size": [6446, 6643, 8090],
        "resolution": [8, 8, 8],
        "chunk_sizes": [[64, 64, 64]],
        "encoding": "raw",
        "voxel_offset": [0, 0, 0]
      },
      {
        "key": "16_16_16",
        "size": [3223, 3322, 4045],
        "resolution": [16, 16, 16],
        "chunk_sizes": [[64, 64, 64]],
        "encoding": "jpeg",
        "voxel_offset": [0, 0, 0]
      }
    ]
  }"""

  private val segmentationInfoJson = """{
    "type": "segmentation",
    "data_type": "uint64",
    "num_channels": 1,
    "mesh": "mesh_mip_0_err_40",
    "scales": [
      {
        "key": "8_8_33",
        "size": [248832, 133120, 7063],
        "resolution": [8, 8, 33],
        "chunk_sizes": [[128, 128, 16]],
        "encoding": "compressed_segmentation",
        "compressed_segmentation_block_size": [8, 8, 8],
        "voxel_offset": [0, 0, 0],
        "sharding": {
          "@type": "neuroglancer_uint64_sharded_v1",
          "preshift_bits": 9,
          "hash": "identity",
          "minishard_bits": 6,
          "shard_bits": 15,
          "minishard_index_encoding": "gzip",
          "data_encoding": "gzip"
        }
      }
    ]
  }"""

  "Neuroglancer precomputed" when {

    "parsing an info of an image volume" should {

      "read the type, data type and scales" in {
        val header = parseHeader(imageInfoJson)
        assert(header.`type` == "image")
        assert(header.data_type == "uint8")
        assert(header.num_channels == 1)
        assert(header.scales.length == 2)
        assert(!header.describesSegmentationLayer)
      }

      "read the scale properties" in {
        val header = parseHeader(imageInfoJson)
        val scale = header.getScale("8_8_8").get
        assert(scale.size.sameElements(Array(6446L, 6643L, 8090L)))
        assert(scale.resolution.sameElements(Array(8.0, 8.0, 8.0)))
        assert(scale.primaryChunkShape.sameElements(Array(64, 64, 64)))
        assert(scale.encoding == "raw")
        assert(scale.voxel_offset.exists(_.sameElements(Array(0, 0, 0))))
        assert(scale.compressed_segmentation_block_size.isEmpty)
        assert(scale.sharding.isEmpty)
        assert(header.getScale("does_not_exist").isEmpty)
      }

      "default the mesh path when no mesh is stated" in {
        val header = parseHeader(imageInfoJson)
        assert(header.mesh.isEmpty)
        assert(header.meshPath == "mesh")
      }

      "derive the scale header from the info and one scale" in {
        val header = parseHeader(imageInfoJson)
        val scaleHeader = PrecomputedScaleHeader(header.getScale("8_8_8").get, header)
        assert(scaleHeader.datasetShape.exists(_.sameElements(Array(6446L, 6643L, 8090L))))
        assert(scaleHeader.chunkShape.sameElements(Array(64, 64, 64)))
        assert(scaleHeader.resolvedDataType == ArrayDataType.u1)
        assert(scaleHeader.elementClass.contains(ElementClass.uint8))
        // These are constants of the format rather than of the document
        assert(scaleHeader.dimension_separator == DimensionSeparator.UNDERSCORE)
        assert(scaleHeader.order == ArrayOrder.F)
        assert(scaleHeader.byteOrder == ByteOrder.LITTLE_ENDIAN)
        assert(scaleHeader.fill_value == Right(0))
        assert(!scaleHeader.isSharded)
      }
    }

    "parsing an info of a segmentation volume" should {

      "read the type and the mesh path" in {
        val header = parseHeader(segmentationInfoJson)
        assert(header.describesSegmentationLayer)
        assert(header.meshPath == "mesh_mip_0_err_40")
        assert(header.data_type == "uint64")
      }

      "read the compressed segmentation block size and the sharding" in {
        val header = parseHeader(segmentationInfoJson)
        val scale = header.scales.head
        assert(scale.encoding == "compressed_segmentation")
        assert(scale.compressed_segmentation_block_size.contains(Vec3Int(8, 8, 8)))
        assert(scale.primaryChunkShape.sameElements(Array(128, 128, 16)))
        val sharding = scale.sharding.get
        assert(sharding.`@type` == "neuroglancer_uint64_sharded_v1")
        assert(sharding.preshift_bits == 9)
        assert(sharding.hash == "identity")
        assert(sharding.minishard_bits == 6)
        assert(sharding.shard_bits == 15)
        assert(sharding.minishard_index_encoding == "gzip")
        assert(sharding.data_encoding == "gzip")
        assert(PrecomputedScaleHeader(scale, header).isSharded)
      }
    }

    "optional scale fields are absent" should {

      val scaleWithoutOptionalsJson = """{
        "key": "1_1_1",
        "size": [1024, 1024, 512],
        "resolution": [1, 1, 1],
        "chunk_sizes": [[64, 64, 64]],
        "encoding": "raw"
      }"""

      "read the scale and default the voxel offset to zero" in {
        val scale = parseScale(scaleWithoutOptionalsJson)
        assert(scale.voxel_offset.isEmpty)
        assert(scale.compressed_segmentation_block_size.isEmpty)
        assert(scale.sharding.isEmpty)
        val header = PrecomputedScaleHeader(scale, parseHeader(imageInfoJson))
        assert(header.voxelOffset.sameElements(Array(0, 0, 0)))
        assert(!header.isSharded)
      }

      "apply the stated voxel offset when it is present" in {
        val scale = parseScale("""{
          "key": "1_1_1",
          "size": [1024, 1024, 512],
          "resolution": [1, 1, 1],
          "chunk_sizes": [[64, 64, 64]],
          "encoding": "raw",
          "voxel_offset": [64, 32, 16]
        }""")
        val header = PrecomputedScaleHeader(scale, parseHeader(imageInfoJson))
        assert(header.voxelOffset.sameElements(Array(64, 32, 16)))
      }
    }

    "a scale states several chunk sizes" should {
      "use the first one" in {
        // The format allows several chunk sizes per scale, we deliberately only support the first.
        val scale = parseScale("""{
          "key": "1_1_1",
          "size": [1024, 1024, 512],
          "resolution": [1, 1, 1],
          "chunk_sizes": [[64, 64, 64], [128, 128, 32], [512, 512, 1]],
          "encoding": "raw"
        }""")
        assert(scale.chunk_sizes.length == 3)
        assert(scale.primaryChunkShape.sameElements(Array(64, 64, 64)))
        assert(PrecomputedScaleHeader(scale, parseHeader(imageInfoJson)).chunkShape.sameElements(Array(64, 64, 64)))
      }
    }

    "the info is malformed or states an unsupported data type" should {
      "reject the document" in {
        // scales missing
        assert(
          JsonHelper
            .parseAs[PrecomputedHeader]("""{"type": "image", "data_type": "uint8", "num_channels": 1}""")
            .isEmpty
        )
        // scale without an encoding
        assert(
          JsonHelper
            .parseAs[PrecomputedScale](
              """{"key": "1_1_1", "size": [1, 1, 1], "resolution": [1, 1, 1], "chunk_sizes": [[1, 1, 1]]}"""
            )
            .isEmpty
        )
      }

      "throw when resolving an unsupported data type" in {
        // int32 is a valid webknossos element class, but not one of the precomputed data types
        val header = parseHeader("""{
          "type": "image",
          "data_type": "int32",
          "num_channels": 1,
          "scales": [{"key": "1_1_1", "size": [1, 1, 1], "resolution": [1, 1, 1],
            "chunk_sizes": [[1, 1, 1]], "encoding": "raw"}]
        }""")
        assertThrows[IllegalArgumentException](PrecomputedScaleHeader(header.scales.head, header).resolvedDataType)
      }

      "accept an upper-case data type" in {
        // The spec states that data_type is matched case-insensitively
        val header = parseHeader("""{
          "type": "image",
          "data_type": "UINT16",
          "num_channels": 1,
          "scales": [{"key": "1_1_1", "size": [1, 1, 1], "resolution": [1, 1, 1],
            "chunk_sizes": [[1, 1, 1]], "encoding": "raw"}]
        }""")
        assert(PrecomputedScaleHeader(header.scales.head, header).resolvedDataType == ArrayDataType.u2)
      }
    }

    "parsing a sharding specification" should {

      "default both encodings to raw" in {
        val sharding = parseSharding("""{
          "@type": "neuroglancer_uint64_sharded_v1",
          "preshift_bits": 0,
          "hash": "identity",
          "minishard_bits": 0,
          "shard_bits": 0
        }""")
        assert(sharding.minishard_index_encoding == "raw")
        assert(sharding.data_encoding == "raw")
      }

      "apply the identity hash function" in {
        val sharding = parseSharding("""{
          "@type": "neuroglancer_uint64_sharded_v1",
          "preshift_bits": 0,
          "hash": "identity",
          "minishard_bits": 3,
          "shard_bits": 6
        }""")
        assert(sharding.hashFunction(42L) == 42L)
        assert(sharding.hashFunction(0L) == 0L)
      }

      "apply the murmurhash3_x86_128 hash function" in {
        val sharding = parseSharding("""{
          "@type": "neuroglancer_uint64_sharded_v1",
          "preshift_bits": 0,
          "hash": "murmurhash3_x86_128",
          "minishard_bits": 3,
          "shard_bits": 6
        }""")
        // Not the identity, but stable for a given input
        assert(sharding.hashFunction(42L) != 42L)
        assert(sharding.hashFunction(42L) == sharding.hashFunction(42L))
      }

      "throw for an unsupported hash function" in {
        val sharding = parseSharding("""{
          "@type": "neuroglancer_uint64_sharded_v1",
          "preshift_bits": 0,
          "hash": "murmurhash3_x64_128",
          "minishard_bits": 3,
          "shard_bits": 6
        }""")
        assertThrows[IllegalArgumentException](sharding.hashFunction(42L))
      }

      "reject a specification without the required bit counts" in
        assert(
          JsonHelper
            .parseAs[ShardingSpecification]("""{"@type": "neuroglancer_uint64_sharded_v1", "hash": "identity"}""")
            .isEmpty
        )
    }

    "selecting the compressor from the parsed header" should {

      def compressorDescriptionForEncoding(encoding: String, extraScaleFields: String = ""): String = {
        val header = parseHeader(s"""{
          "type": "image",
          "data_type": "uint32",
          "num_channels": 1,
          "scales": [{"key": "1_1_1", "size": [64, 64, 64], "resolution": [1, 1, 1],
            "chunk_sizes": [[64, 64, 64]], "encoding": "$encoding"$extraScaleFields}]
        }""")
        // ChainedCompressor does not expose its members, so assert on its description
        PrecomputedScaleHeader(header.scales.head, header).compressorImpl.toString
      }

      "resolve the chunk encodings" in {
        assert(compressorDescriptionForEncoding("raw").contains("chainedcompressor"))
        assert(compressorDescriptionForEncoding("raw").contains("NullCompressor"))
        assert(compressorDescriptionForEncoding("jpeg").contains("jpeg"))
        assert(compressorDescriptionForEncoding("compresso").contains("compresso"))
        assert(compressorDescriptionForEncoding("compressed_segmentation").contains("compressedsegmentation"))
      }

      "chain the sharding data encoding onto the chunk encoding" in {
        val sharding = """, "sharding": {"@type": "neuroglancer_uint64_sharded_v1", "preshift_bits": 0,
          "hash": "identity", "minishard_bits": 0, "shard_bits": 0, "data_encoding": "gzip"}"""
        val description = compressorDescriptionForEncoding("compressed_segmentation", sharding)
        assert(description.contains("compressedsegmentation"))
        assert(description.contains("gzip"))
      }

      "leave the chain uncompressed when the sharding data encoding is raw" in {
        val sharding = """, "sharding": {"@type": "neuroglancer_uint64_sharded_v1", "preshift_bits": 0,
          "hash": "identity", "minishard_bits": 0, "shard_bits": 0}"""
        val description = compressorDescriptionForEncoding("raw", sharding)
        assert(!description.contains("gzip"))
        assert(description.contains("NullCompressor"))
      }

      "throw for an unknown chunk encoding" in
        assertThrows[IllegalArgumentException](compressorDescriptionForEncoding("png"))

      "throw for an unknown sharding data encoding" in {
        val sharding = """, "sharding": {"@type": "neuroglancer_uint64_sharded_v1", "preshift_bits": 0,
          "hash": "identity", "minishard_bits": 0, "shard_bits": 0, "data_encoding": "zstd"}"""
        assertThrows[IllegalArgumentException](compressorDescriptionForEncoding("raw", sharding))
      }
    }
  }

}
