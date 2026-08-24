package backend

import com.scalableminds.util.box.Failure
import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.datareaders.{ArrayDataType, ArrayOrder, DimensionSeparator}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  BloscCodecConfiguration,
  BytesCodecConfiguration,
  Crc32CCodecConfiguration,
  ShardingCodecConfiguration,
  TransposeCodecConfiguration,
  Zarr3Array,
  Zarr3ArrayHeader,
  ZstdCodecConfiguration
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader.Zarr3ArrayHeaderFormat
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import org.scalatest.wordspec.AsyncWordSpec

import java.nio.ByteOrder

class Zarr3TestSuite extends AsyncWordSpec {

  private def parseHeader(json: String): Zarr3ArrayHeader =
    JsonHelper.parseAs[Zarr3ArrayHeader](json).get("test execution")

  private def failureChain(failure: Failure): String =
    (failure.msg :: failure.chain.toList.map(failureChain)).mkString(" <- ")

  "Zarr 3" when {

    "parsing zarr.json" should {

      val zarr3json =
        """
        { "shape": [64,64,64],
          "data_type":"uint8",
          "zarr_format":3,
          "chunk_grid": {"configuration": {
           "chunk_shape": [8,8,8]},
       		"name": "regular" },
          "chunk_key_encoding": { "configuration":{"separator": "/"}, "name":"default"},
          "fill_value": 0,
          "codecs":[{"configuration": {"endian": "little"}, "name": "bytes"}, {"configuration": {"typesize": 4, "cname": "zstd", "clevel": 5, "shuffle": "noshuffle", "blocksize": 0}, "name": "blosc"}],
          "attributes": { "att1":"test"},
          "dimension_names": ["x","y","z"],
          "node_type":"array"}""".stripMargin

      "read correct basic header data" in {
        val header = JsonHelper.parseAs[Zarr3ArrayHeader](zarr3json).get("test execution")
        assert(header.shape.sameElements(Seq(64, 64, 64)))
        assert(header.data_type.left.getOrElse("notUint8") == "uint8")
        assert(header.zarr_format == 3)
        assert(header.fill_value == Right[String, Number](0))
        assert(header.dimension_names.get.sameElements(Seq("x", "y", "z")))
      }

      "parse basic codecs" in {
        val header = JsonHelper.parseAs[Zarr3ArrayHeader](zarr3json).get("test execution")
        assert(header.codecs.length == 2)
        assert(header.codecs(0).isInstanceOf[BytesCodecConfiguration])
        assert(header.codecs(1).isInstanceOf[BloscCodecConfiguration])
        val array = new Zarr3Array(null, null, null, header, null, null, null, null)
        assert(array.codecs.length == 2)
      }
    }

    "parsing a sharded zarr.json" should {

      // Captured from a zarr v3 segmentation mag: an outer 256³ shard split into
      // 32³ inner chunks, transposed to F order, with a crc32c-checksummed shard index.
      val shardedJson =
        """{"chunk_grid":{"configuration":{"chunk_shape":[1,256,256,256]},"name":"regular"},
           "chunk_key_encoding":{"name":"default"},
           "codecs":[{"configuration":{"chunk_shape":[1,32,32,32],
             "codecs":[{"configuration":{"order":[3,2,1,0]},"name":"transpose"},
                       {"configuration":{"endian":"little"},"name":"bytes"},
                       {"configuration":{"checksum":true,"level":5},"name":"zstd"}],
             "index_codecs":[{"configuration":{"endian":"little"},"name":"bytes"},{"name":"crc32c"}]},
             "name":"sharding_indexed"}],
           "data_type":"uint32","dimension_names":["c","x","y","z"],"fill_value":0,
           "node_type":"array","shape":[1,256,256,256],"zarr_format":3}"""

      "report the inner chunk shape as chunk shape and the outer one as shard shape" in {
        val header = parseHeader(shardedJson)
        assert(header.isSharded)
        assert(header.outerChunkShape.sameElements(Array(1, 256, 256, 256)))
        assert(header.chunkShape.sameElements(Array(1, 32, 32, 32)))
        assert(header.rank == 4)
        assert(header.shape.sameElements(Array(1L, 256L, 256L, 256L)))
        assert(header.bytesPerChunk == 32 * 32 * 32 * 4)
      }

      "read the inner and the index codec chain" in {
        val header = parseHeader(shardedJson)
        assert(header.codecs.length == 1)
        val sharding = header.codecs.head.asInstanceOf[ShardingCodecConfiguration]
        assert(sharding.chunk_shape.sameElements(Array(1, 32, 32, 32)))
        assert(sharding.codecs.map(_.name) == Seq("transpose", "bytes", "zstd"))
        assert(sharding.codecs(2).asInstanceOf[ZstdCodecConfiguration].level == 5)
        assert(sharding.codecs(2).asInstanceOf[ZstdCodecConfiguration].checksum)
        assert(sharding.index_codecs.map(_.name) == Seq("bytes", "crc32c"))
        assert(sharding.index_codecs(1) == Crc32CCodecConfiguration)
        assert(sharding.isSupported.isDefined)
      }

      "derive F order from the transpose codec inside the sharding codec" in {
        val header = parseHeader(shardedJson)
        assert(header.order == ArrayOrder.F)
        assert(header.resolvedDataType == ArrayDataType.u4)
        assert(header.elementClass.contains(ElementClass.uint32))
        assert(header.byteOrder == ByteOrder.LITTLE_ENDIAN)
        assert(header.assertValid.isDefined)
      }

      "reject a sharding codec whose index codecs are not supported" in {
        val twoBytesCodecsJson =
          """{"chunk_grid":{"configuration":{"chunk_shape":[32,32]},"name":"regular"},
             "chunk_key_encoding":{"name":"default"},
             "codecs":[{"configuration":{"chunk_shape":[8,8],
               "codecs":[{"configuration":{"endian":"little"},"name":"bytes"}],
               "index_codecs":[{"configuration":{"endian":"little"},"name":"bytes"},
                               {"configuration":{"endian":"little"},"name":"bytes"}]},
               "name":"sharding_indexed"}],
             "data_type":"uint8","fill_value":0,"node_type":"array","shape":[64,64],"zarr_format":3}"""
        val header = parseHeader(twoBytesCodecsJson)
        assert(header.isSharded)
        assert(header.assertValid.isEmpty)
      }
    }

    "dimension_names are absent" should {
      "read no dimension names" in {
        // Captured from a segment statistics attachment
        val json =
          """{"chunk_grid":{"configuration":{"chunk_shape":[134217728]},"name":"regular"},
             "chunk_key_encoding":{"name":"default"},
             "codecs":[{"configuration":{"chunk_shape":[4096],
               "codecs":[{"configuration":{"endian":"little"},"name":"bytes"},
                         {"configuration":{"checksum":true,"level":5},"name":"zstd"}],
               "index_codecs":[{"configuration":{"endian":"little"},"name":"bytes"},{"name":"crc32c"}]},
               "name":"sharding_indexed"}],
             "data_type":"uint32","fill_value":0,"node_type":"array","shape":[1332],"zarr_format":3}"""
        val header = parseHeader(json)
        assert(header.dimension_names.isEmpty)
        // The spec allows null entries in dimension_names, which we cannot model, so the field is ignored then
        assert(
          parseHeader(
            json.replace(""""shape":[1332]""", """"dimension_names":[null],"shape":[1332]""")
          ).dimension_names.isEmpty
        )
        assert(header.rank == 1)
        assert(header.chunkShape.sameElements(Array(4096)))
        assert(header.outerChunkShape.sameElements(Array(134217728)))
        // Without a transpose codec the array stays in C order
        assert(header.order == ArrayOrder.C)
        assert(header.dimension_separator == DimensionSeparator.SLASH)
        assert(header.assertValid.isDefined)
      }
    }

    "the chunk shape is not a power of two" should {
      "read it unchanged" in {
        val json = """{
          "shape": [3, 1024, 780],
          "data_type": "uint16",
          "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [3, 100, 65]}, "name": "regular"},
          "chunk_key_encoding": {"configuration": {"separator": "."}, "name": "v2"},
          "fill_value": 0,
          "codecs": [{"configuration": {"endian": "big"}, "name": "bytes"}],
          "node_type": "array"
        }"""
        val header = parseHeader(json)
        assert(header.chunkShape.sameElements(Array(3, 100, 65)))
        assert(header.bytesPerChunk == 3 * 100 * 65 * 2)
        assert(!header.isSharded)
        // The v2 chunk key encoding uses the dot separator
        assert(header.dimension_separator == DimensionSeparator.DOT)
        assert(header.byteOrder == ByteOrder.BIG_ENDIAN)
        assert(header.assertValid.isDefined)
      }
    }

    "the codec chain contains transpose and crc32c" should {
      "read all of them in order" in {
        val json = """{
          "shape": [64, 64, 64],
          "data_type": "uint8",
          "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [8, 8, 8]}, "name": "regular"},
          "chunk_key_encoding": {"configuration": {"separator": "/"}, "name": "default"},
          "fill_value": 0,
          "codecs": [
            {"configuration": {"order": [2, 1, 0]}, "name": "transpose"},
            {"configuration": {"endian": "little"}, "name": "bytes"},
            {"configuration": {"level": 5}, "name": "gzip"},
            {"name": "crc32c"}
          ],
          "node_type": "array"
        }"""
        val header = parseHeader(json)
        assert(header.codecs.map(_.name) == Seq("transpose", "bytes", "gzip", "crc32c"))
        assert(header.codecs.head.isInstanceOf[TransposeCodecConfiguration])
        assert(header.codecs(3) == Crc32CCodecConfiguration)
        // order [2,1,0] is the F order for rank 3
        assert(header.order == ArrayOrder.F)
        assert(header.assertValid.isDefined)
      }

      "read the string form of the transpose order" in {
        val json = """{
          "shape": [64, 64], "data_type": "uint8", "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [8, 8]}, "name": "regular"},
          "chunk_key_encoding": {"name": "default"}, "fill_value": 0,
          "codecs": [{"configuration": {"order": "F"}, "name": "transpose"},
                     {"configuration": {"endian": "little"}, "name": "bytes"}],
          "node_type": "array"
        }"""
        assert(parseHeader(json).order == ArrayOrder.F)
      }

      "leave a transpose order that is neither C nor F in C order" in {
        val json = """{
          "shape": [64, 64, 64], "data_type": "uint8", "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [8, 8, 8]}, "name": "regular"},
          "chunk_key_encoding": {"name": "default"}, "fill_value": 0,
          "codecs": [{"configuration": {"order": [1, 0, 2]}, "name": "transpose"},
                     {"configuration": {"endian": "little"}, "name": "bytes"}],
          "node_type": "array"
        }"""
        // Only orders equivalent to F or C are supported, see https://github.com/scalableminds/webknossos/issues/7116
        assert(parseHeader(json).order == ArrayOrder.C)
      }
    }

    "the data type is not supported" should {

      def headerWithDataType(dataType: String): Zarr3ArrayHeader =
        parseHeader(s"""{
          "shape": [64], "data_type": "$dataType", "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [8]}, "name": "regular"},
          "chunk_key_encoding": {"name": "default"}, "fill_value": 0,
          "codecs": [{"configuration": {"endian": "little"}, "name": "bytes"}],
          "node_type": "array"
        }""")

      "fail validation for a zarr data type webknossos cannot read" in {
        // float16, complex64 and the rN raw types are valid zarr v3, but have no webknossos element class
        assert(headerWithDataType("float16").assertValid.isEmpty)
        assert(headerWithDataType("complex64").assertValid.isEmpty)
        assert(headerWithDataType("r8").assertValid.isEmpty)
      }

      "fail validation for an unknown data type" in
        assert(headerWithDataType("uint4").assertValid.isEmpty)

      "read the supported data types" in {
        assert(headerWithDataType("bool").resolvedDataType == ArrayDataType.bool)
        assert(headerWithDataType("int8").resolvedDataType == ArrayDataType.i1)
        assert(headerWithDataType("uint64").resolvedDataType == ArrayDataType.u8)
        assert(headerWithDataType("float32").resolvedDataType == ArrayDataType.f4)
        assert(headerWithDataType("float64").resolvedDataType == ArrayDataType.f8)
      }
    }

    "the document is not a valid zarr v3 array" should {

      "reject a missing required field" in {
        // chunk_grid missing
        assert(
          JsonHelper
            .parseAs[Zarr3ArrayHeader](
              """{"shape": [64], "data_type": "uint8", "zarr_format": 3, "fill_value": 0,
                 "chunk_key_encoding": {"name": "default"}, "codecs": [], "node_type": "array"}"""
            )
            .isEmpty
        )
        // codecs missing
        assert(
          JsonHelper
            .parseAs[Zarr3ArrayHeader](
              """{"shape": [64], "data_type": "uint8", "zarr_format": 3, "fill_value": 0,
                 "chunk_grid": {"configuration": {"chunk_shape": [8]}, "name": "regular"},
                 "chunk_key_encoding": {"name": "default"}, "node_type": "array"}"""
            )
            .isEmpty
        )
      }

      "fail validation for a wrong zarr format or node type" in {
        val groupJson = """{
          "shape": [64], "data_type": "uint8", "zarr_format": 2,
          "chunk_grid": {"configuration": {"chunk_shape": [8]}, "name": "regular"},
          "chunk_key_encoding": {"name": "default"}, "fill_value": 0,
          "codecs": [{"configuration": {"endian": "little"}, "name": "bytes"}],
          "node_type": "group"
        }"""
        assert(parseHeader(groupJson).assertValid.isEmpty)
      }

      "reject an unsupported codec name" in {
        // A codec we cannot read must fail the header, since decoding chunks without it would yield wrong data
        val json = """{
          "shape": [64], "data_type": "uint8", "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [8]}, "name": "regular"},
          "chunk_key_encoding": {"name": "default"}, "fill_value": 0,
          "codecs": [{"configuration": {"endian": "little"}, "name": "bytes"},
                     {"configuration": {"digits": 4}, "name": "quantize"}],
          "node_type": "array"
        }"""
        JsonHelper.parseAs[Zarr3ArrayHeader](json) match {
          case failure: Failure => assert(failureChain(failure).contains("Codec quantize is not supported"))
          case other            => fail(s"expected Failure, got $other")
        }
      }

      "reject a codec whose configuration cannot be read" in {
        val json = """{
          "shape": [64], "data_type": "uint8", "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [8]}, "name": "regular"},
          "chunk_key_encoding": {"name": "default"}, "fill_value": 0,
          "codecs": [{"configuration": {"endian": "little"}, "name": "bytes"},
                     {"configuration": {"level": "high"}, "name": "gzip"}],
          "node_type": "array"
        }"""
        assert(JsonHelper.parseAs[Zarr3ArrayHeader](json).isEmpty)
        // A codec entry without a name is rejected as well
        val noNameJson = """{
          "shape": [64], "data_type": "uint8", "zarr_format": 3,
          "chunk_grid": {"configuration": {"chunk_shape": [8]}, "name": "regular"},
          "chunk_key_encoding": {"name": "default"}, "fill_value": 0,
          "codecs": [{"configuration": {"endian": "little"}}],
          "node_type": "array"
        }"""
        assert(JsonHelper.parseAs[Zarr3ArrayHeader](noNameJson).isEmpty)
      }
    }
  }

}
