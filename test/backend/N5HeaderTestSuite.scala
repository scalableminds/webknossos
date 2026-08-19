package backend

import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.datareaders.{
  ArrayDataType,
  ArrayOrder,
  BloscCompressor,
  DimensionSeparator,
  GzipCompressor,
  NullCompressor,
  ZlibCompressor,
  ZstdCompressor
}
import com.scalableminds.webknossos.datastore.datareaders.n5.{
  N5CompactMultiscalesMetadata,
  N5Header,
  N5Metadata,
  N5MultiscalesItem
}
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import org.scalatest.wordspec.AsyncWordSpec

import java.nio.ByteOrder

class N5HeaderTestSuite extends AsyncWordSpec {

  private def parseHeader(json: String): N5Header =
    JsonHelper.parseAs[N5Header](json).get("test execution")

  private def headerWithCompression(compressionJson: String): N5Header =
    parseHeader(s"""{
      "dimensions": [16, 16, 16],
      "blockSize": [8, 8, 8],
      "dataType": "uint8",
      "compression": $compressionJson
    }""")

  "N5" when {

    "parsing an attributes.json of a single scale" should {

      // Captured from the s3 mag of an N5 FIB-SEM volume written by the n5-java library.
      // Note the pixelResolution/transform keys, which N5Header does not model and has to ignore.
      val attributesJson = """{
        "blockSize": [64, 64, 64],
        "compression": {
          "level": -1,
          "type": "gzip",
          "useZlib": false
        },
        "dataType": "uint16",
        "dimensions": [1550, 125, 1500],
        "pixelResolution": {
          "dimensions": [32.0, 32.0, 25.92000000000001],
          "unit": "nm"
        },
        "transform": {
          "axes": ["z", "y", "x"],
          "scale": [25.92000000000001, 32.0, 32.0],
          "translate": [11.340000000000003, 14.0, 14.0],
          "units": ["nm", "nm", "nm"]
        }
      }"""

      "read dimensions, blockSize and dataType" in {
        val header = parseHeader(attributesJson)
        assert(header.dimensions.sameElements(Array(1550L, 125L, 1500L)))
        assert(header.blockSize.sameElements(Array(64, 64, 64)))
        assert(header.dataType == "uint16")
        assert(header.resolvedDataType == ArrayDataType.u2)
        assert(header.elementClass.contains(ElementClass.uint16))
        assert(header.datasetShape.exists(_.sameElements(Array(1550L, 125L, 1500L))))
        assert(header.chunkShape.sameElements(Array(64, 64, 64)))
        assert(header.bytesPerChunk == 64 * 64 * 64 * 2)
      }

      "read the compression" in {
        val header = parseHeader(attributesJson)
        assert(header.compression.isDefined)
        // useZlib is false here, so this stays a plain gzip stream
        assert(header.compressorImpl.isInstanceOf[GzipCompressor])
        assert(header.compressorImpl.asInstanceOf[GzipCompressor].level == -1)
      }

      "use the N5-wide constants for the fields the format does not state" in {
        val header = parseHeader(attributesJson)
        // N5 chunk keys are nested directories, and N5 is always F-order and big endian
        assert(header.dimension_separator == DimensionSeparator.SLASH)
        assert(header.order == ArrayOrder.F)
        assert(header.byteOrder == ByteOrder.BIG_ENDIAN)
        assert(header.fill_value == Right(0))
        assert(header.voxelOffset.sameElements(Array(0, 0, 0)))
        assert(!header.isSharded)
      }
    }

    "the compression is absent" should {
      "default to no compression" in {
        val header = parseHeader("""{"dimensions": [16, 16, 16], "blockSize": [8, 8, 8], "dataType": "uint8"}""")
        assert(header.compression.isEmpty)
        assert(header.compressorImpl.isInstanceOf[NullCompressor])
        assert(header.dimension_separator == DimensionSeparator.SLASH)
      }
    }

    "required fields are missing or the dataType is unsupported" should {
      "reject the document" in {
        assert(JsonHelper.parseAs[N5Header]("""{"blockSize": [8, 8, 8], "dataType": "uint8"}""").isEmpty)
        assert(JsonHelper.parseAs[N5Header]("""{"dimensions": [16], "blockSize": [8]}""").isEmpty)
      }

      "throw when resolving an unsupported dataType" in {
        val header = parseHeader("""{"dimensions": [16], "blockSize": [8], "dataType": "float16"}""")
        assertThrows[IllegalArgumentException](header.resolvedDataType)
        val objectHeader = parseHeader("""{"dimensions": [16], "blockSize": [8], "dataType": "object"}""")
        assertThrows[IllegalArgumentException](objectHeader.resolvedDataType)
      }
    }

    "selecting the compressor from the parsed header" should {
      "resolve the known compression types" in {
        // "raw" is the N5 spec’s identifier for uncompressed data
        assert(headerWithCompression("""{"type": "raw"}""").compressorImpl.isInstanceOf[NullCompressor])
        assert(headerWithCompression("""{"type": "null"}""").compressorImpl.isInstanceOf[NullCompressor])
        assert(headerWithCompression("""{"type": "zlib", "level": 6}""").compressorImpl.isInstanceOf[ZlibCompressor])
        assert(headerWithCompression("""{"type": "gzip", "level": 6}""").compressorImpl.isInstanceOf[GzipCompressor])
        assert(
          headerWithCompression("""{"type": "blosc", "cname": "lz4", "clevel": 5, "shuffle": 1}""").compressorImpl
            .isInstanceOf[BloscCompressor]
        )
        assert(headerWithCompression("""{"type": "zstd", "level": 3}""").compressorImpl.isInstanceOf[ZstdCompressor])
      }

      "resolve gzip with useZlib to a zlib compressor" in {
        // N5 writes raw zlib streams (no gzip wrapper) when useZlib is set
        val useZlib = headerWithCompression("""{"type": "gzip", "level": 6, "useZlib": true}""")
        assert(useZlib.compressorImpl.isInstanceOf[ZlibCompressor])
        val noUseZlib = headerWithCompression("""{"type": "gzip", "level": 6, "useZlib": false}""")
        assert(noUseZlib.compressorImpl.isInstanceOf[GzipCompressor])
      }

      "throw for an unknown compression type" in {
        // lz4, xz and bzip2 are valid N5 compression types that webknossos does not implement
        assertThrows[IllegalArgumentException](headerWithCompression("""{"type": "lz4"}""").compressorImpl)
        assertThrows[IllegalArgumentException](headerWithCompression("""{"type": "xz"}""").compressorImpl)
        assertThrows[IllegalArgumentException](headerWithCompression("""{"type": 5}""").compressorImpl)
      }
    }

    "parsing the multiscales attributes.json" should {

      // Captured from the group-level attributes.json of the same N5 FIB-SEM volume.
      // The axes/n5/pixelResolution/scales/units keys are not modelled by N5Metadata and have to be ignored.
      val multiscalesJson = """{
        "axes": ["x", "y", "z"],
        "multiscales": [
          {
            "datasets": [
              {
                "path": "s3",
                "transform": {
                  "axes": ["z", "y", "x"],
                  "scale": [25.92000000000001, 32.0, 32.0],
                  "translate": [11.340000000000003, 14.0, 14.0],
                  "units": ["nm", "nm", "nm"]
                }
              },
              {
                "path": "s4",
                "transform": {
                  "axes": ["z", "y", "x"],
                  "scale": [51.84000000000002, 64.0, 64.0],
                  "translate": [24.30000000000001, 30.0, 30.0],
                  "units": ["nm", "nm", "nm"]
                }
              }
            ],
            "name": "em/fibsem-uint16"
          }
        ],
        "n5": "2.0.0",
        "pixelResolution": {
          "dimensions": [4.0, 4.0, 3.24],
          "unit": "nm"
        },
        "scales": [[8, 8, 8], [16, 16, 16]],
        "units": ["nm", "nm", "nm"]
      }"""

      "read the datasets with their transforms" in {
        val metadata = JsonHelper.parseAs[N5Metadata](multiscalesJson).get("test execution")
        assert(metadata.multiscales.length == 1)
        val datasets = metadata.multiscales.head.datasets
        assert(datasets.map(_.path) == List("s3", "s4"))
        assert(datasets.head.transform.axes == List("z", "y", "x"))
        assert(datasets.head.transform.scale == List(25.92000000000001, 32.0, 32.0))
        assert(datasets.head.transform.units.contains(List("nm", "nm", "nm")))
        assert(datasets(1).transform.scale == List(51.84000000000002, 64.0, 64.0))
      }

      "read a transform without units" in {
        val itemJson = """{
          "datasets": [
            {"path": "s0", "transform": {"axes": ["z", "y", "x"], "scale": [40.0, 4.0, 4.0]}}
          ]
        }"""
        val item = JsonHelper.parseAs[N5MultiscalesItem](itemJson).get("test execution")
        assert(item.datasets.head.transform.units.isEmpty)
        assert(item.datasets.head.transform.scale == List(40.0, 4.0, 4.0))
      }

      "reject a dataset without a transform" in
        assert(JsonHelper.parseAs[N5Metadata]("""{"multiscales": [{"datasets": [{"path": "s0"}]}]}""").isEmpty)
    }

    "parsing the compact multiscales attributes.json" should {

      // Shaped after the compact multiscales metadata described in the neuroglancer n5 datasource docs
      // (linked from N5Metadata.scala): the downsampling factors live in the top level of the group attributes.
      val compactJson = """{
        "axes": ["x", "y", "z"],
        "downsamplingFactors": [[1, 1, 1], [2, 2, 1], [4, 4, 2]],
        "multiScale": true,
        "resolution": [4.0, 4.0, 40.0],
        "units": ["nm", "nm", "nm"]
      }"""

      "read axes, downsampling factors, resolution and units" in {
        val metadata = JsonHelper.parseAs[N5CompactMultiscalesMetadata](compactJson).get("test execution")
        assert(metadata.axes.contains(List("x", "y", "z")))
        assert(metadata.downsamplingFactors.contains(List(List(1, 1, 1), List(2, 2, 1), List(4, 4, 2))))
        assert(metadata.scales.isEmpty)
        assert(metadata.multiScale.contains(true))
        assert(metadata.resolution == List(4.0, 4.0, 40.0))
        assert(metadata.units.contains(List("nm", "nm", "nm")))
      }

      "read the variant that states scales instead of downsamplingFactors" in {
        val scalesJson = """{"scales": [[1, 1, 1], [2, 2, 2]], "multiScale": true, "resolution": [4.0, 4.0, 40.0]}"""
        val metadata = JsonHelper.parseAs[N5CompactMultiscalesMetadata](scalesJson).get("test execution")
        assert(metadata.downsamplingFactors.isEmpty)
        assert(metadata.scales.contains(List(List(1, 1, 1), List(2, 2, 2))))
        assert(metadata.axes.isEmpty)
        assert(metadata.units.isEmpty)
      }

      "reject a document without a resolution" in
        // resolution is the only non-optional field, so the multiscales metadata of the FIB-SEM volume above
        // (which states pixelResolution instead) is not readable as compact metadata
        assert(
          JsonHelper.parseAs[N5CompactMultiscalesMetadata]("""{"scales": [[1, 1, 1]], "multiScale": true}""").isEmpty
        )
    }
  }

}
