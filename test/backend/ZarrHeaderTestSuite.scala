package backend

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
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
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrHeader
import com.scalableminds.webknossos.datastore.models.datasource.{DataFormat, ElementClass, StaticColorLayer}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.Json

import java.nio.ByteOrder

class ZarrHeaderTestSuite extends AsyncWordSpec {

  private def parseHeader(json: String): ZarrHeader =
    JsonHelper.parseAs[ZarrHeader](json).get("test execution")

  // Minimal .zarray with only the fields that ZarrHeader requires, so that a single aspect can be varied.
  private def headerWithDtype(dtype: String): ZarrHeader =
    parseHeader(s"""{"zarr_format": 2, "shape": [4, 4], "chunks": [2, 2], "dtype": "$dtype", "order": "C"}""")

  private def headerWithCompressor(compressorJson: String): ZarrHeader =
    parseHeader(s"""{
      "zarr_format": 2,
      "shape": [4, 4],
      "chunks": [2, 2],
      "dtype": "<u2",
      "order": "C",
      "compressor": $compressorJson
    }""")

  "Zarr 2" when {

    "parsing a .zarray written by zarr-python" should {

      // Captured from the “raw” layer of a zarr v2 dataset produced by a python pipeline
      // (zarr-python 2.x default output, pretty-printed, blosc-compressed, no dimension_separator).
      val zarrayJson = """{
          "chunks": [82, 82, 82],
          "compressor": {
              "blocksize": 0,
              "clevel": 5,
              "cname": "lz4",
              "id": "blosc",
              "shuffle": 1
          },
          "dtype": "<f4",
          "fill_value": 0.0,
          "filters": null,
          "order": "C",
          "shape": [656, 656, 656],
          "zarr_format": 2
      }"""

      "read shape, chunks, dtype and order" in {
        val header = parseHeader(zarrayJson)
        assert(header.zarr_format == 2)
        assert(header.shape.sameElements(Array(656L, 656L, 656L)))
        assert(header.chunks.sameElements(Array(82, 82, 82)))
        assert(header.dtype == "<f4")
        assert(header.order == ArrayOrder.C)
        assert(header.rank == 3)
      }

      "derive the array properties from shape, chunks and dtype" in {
        val header = parseHeader(zarrayJson)
        assert(header.datasetShape.exists(_.sameElements(Array(656L, 656L, 656L))))
        assert(header.chunkShape.sameElements(Array(82, 82, 82)))
        assert(header.resolvedDataType == ArrayDataType.f4)
        assert(header.elementClass.contains(ElementClass.float))
        assert(header.bytesPerElement == 4)
        assert(header.bytesPerChunk == 82 * 82 * 82 * 4)
        assert(header.byteOrder == ByteOrder.LITTLE_ENDIAN)
        assert(header.voxelOffset.sameElements(Array(0, 0, 0)))
        assert(!header.isSharded)
      }

      "read the compressor and the filters" in {
        val header = parseHeader(zarrayJson)
        assert(header.compressor.isDefined)
        assert(header.compressorImpl.isInstanceOf[BloscCompressor])
        val blosc = header.compressorImpl.asInstanceOf[BloscCompressor]
        assert(blosc.cname.getValue == "lz4")
        assert(blosc.clevel == 5)
        assert(blosc.blocksize == 0)
        // "filters": null is read as no filters at all
        assert(header.filters.isEmpty)
      }

      "fall back to the default dimension separator" in {
        val header = parseHeader(zarrayJson)
        assert(header.dimension_separator == DimensionSeparator.DOT)
      }
    }

    "parsing a .zarray with big-endian dtype, string fill value and empty filters" should {

      // Captured from a 5-dimensional zarr v2 dataset (single line, as written), which uses
      // the string form of fill_value and an explicit empty filters list.
      val zarrayJson =
        """{"shape":[1,2,140,163,170],"chunks":[1,1,1,163,170],"fill_value":"0","dtype":">u2","filters":[],
           "zarr_format":2,"compressor":{"id":"blosc","cname":"lz4","clevel":5,"shuffle":1,"blocksize":0},"order":"C"}"""

      "read the 5-dimensional shape and chunks" in {
        val header = parseHeader(zarrayJson)
        assert(header.shape.sameElements(Array(1L, 2L, 140L, 163L, 170L)))
        assert(header.chunks.sameElements(Array(1, 1, 1, 163, 170)))
        assert(header.rank == 5)
        assert(header.voxelOffset.sameElements(Array(0, 0, 0, 0, 0)))
      }

      "read big-endian byte order and the unprefixed data type" in {
        val header = parseHeader(zarrayJson)
        assert(header.byteOrder == ByteOrder.BIG_ENDIAN)
        assert(header.resolvedDataType == ArrayDataType.u2)
      }

      "read the string fill value and the empty filters list" in {
        val header = parseHeader(zarrayJson)
        assert(header.fill_value == Left("0"))
        // Fill values that are not "NaN"/"Infinity"/"-Infinity" fall back to 0 rather than throwing
        assert(header.fillValueNumber == 0)
        assert(header.filters.contains(List()))
      }
    }

    "parsing fill_value" should {
      "read numeric and non-numeric literals" in {
        assert(headerWithDtype("<f4").fill_value == Right(0)) // default
        assert(parseHeader("""{"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "<f4", "order": "C",
             "fill_value": 7}""").fill_value == Right(7))
        val nanHeader = parseHeader("""{"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "<f4", "order": "C",
             "fill_value": "NaN"}""")
        assert(nanHeader.fill_value == Left("NaN"))
        assert(nanHeader.fillValueNumber == 0)
        val infHeader = parseHeader("""{"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "<f4", "order": "C",
             "fill_value": "Infinity"}""")
        assert(infHeader.fillValueNumber == Float.MaxValue)
      }
    }

    "deriving the byte order from the dtype prefix" should {
      "map > to big endian, < to little endian, | to native order and no prefix to big endian" in {
        assert(headerWithDtype(">u2").byteOrder == ByteOrder.BIG_ENDIAN)
        assert(headerWithDtype("<u2").byteOrder == ByteOrder.LITTLE_ENDIAN)
        assert(headerWithDtype("|u1").byteOrder == ByteOrder.nativeOrder)
        assert(headerWithDtype("u1").byteOrder == ByteOrder.BIG_ENDIAN)
      }
    }

    "resolving the data type" should {
      "strip the byte order prefix" in {
        assert(headerWithDtype("|u1").resolvedDataType == ArrayDataType.u1)
        assert(headerWithDtype("<u2").resolvedDataType == ArrayDataType.u2)
        assert(headerWithDtype(">i4").resolvedDataType == ArrayDataType.i4)
        assert(headerWithDtype("<f8").resolvedDataType == ArrayDataType.f8)
        assert(headerWithDtype("u1").resolvedDataType == ArrayDataType.u1)
      }

      "throw for unsupported dtypes" in {
        // float16 and datetimes are valid zarr v2 dtypes, but webknossos cannot read them
        assertThrows[IllegalArgumentException](headerWithDtype("<f2").resolvedDataType)
        assertThrows[IllegalArgumentException](headerWithDtype("<M8[ns]").resolvedDataType)
      }
    }

    "optional fields are absent" should {
      "apply the defaults" in {
        val header = headerWithDtype("<u2")
        assert(header.dimension_separator == DimensionSeparator.DOT)
        assert(header.fill_value == Right(0))
        assert(header.compressor.isEmpty)
        assert(header.filters.isEmpty)
        assert(header.compressorImpl.isInstanceOf[NullCompressor])
      }

      "read an explicit dimension separator" in {
        val header = parseHeader("""{"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "<u2", "order": "C",
             "dimension_separator": "/"}""")
        assert(header.dimension_separator == DimensionSeparator.SLASH)
      }
    }

    "required fields are missing or malformed" should {
      "reject the document" in {
        // dtype missing
        assert(
          JsonHelper.parseAs[ZarrHeader]("""{"zarr_format": 2, "shape": [4], "chunks": [2], "order": "C"}""").isEmpty
        )
        // order missing
        assert(
          JsonHelper.parseAs[ZarrHeader]("""{"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "<u2"}""").isEmpty
        )
        // order not one of F, C
        assert(
          JsonHelper
            .parseAs[ZarrHeader]("""{"zarr_format": 2, "shape": [4], "chunks": [2], "dtype": "<u2", "order": "Z"}""")
            .isEmpty
        )
        // shape is not an array of numbers
        assert(
          JsonHelper
            .parseAs[ZarrHeader]("""{"zarr_format": 2, "shape": "4", "chunks": [2], "dtype": "<u2", "order": "C"}""")
            .isEmpty
        )
        assert(JsonHelper.parseAs[ZarrHeader]("not json at all").isEmpty)
      }
    }

    "selecting the compressor from the parsed header" should {
      "resolve the known compressor ids" in {
        assert(headerWithCompressor("""{"id": "null"}""").compressorImpl.isInstanceOf[NullCompressor])
        assert(headerWithCompressor("""{"id": "zlib", "level": 1}""").compressorImpl.isInstanceOf[ZlibCompressor])
        assert(headerWithCompressor("""{"id": "gzip", "level": 5}""").compressorImpl.isInstanceOf[GzipCompressor])
        assert(
          headerWithCompressor("""{"id": "blosc", "cname": "zstd", "clevel": 5, "shuffle": 2, "blocksize": 0}""").compressorImpl
            .isInstanceOf[BloscCompressor]
        )
        assert(headerWithCompressor("""{"id": "zstd", "level": 3}""").compressorImpl.isInstanceOf[ZstdCompressor])
      }

      "throw for an unknown compressor id" in {
        assertThrows[IllegalArgumentException](headerWithCompressor("""{"id": "lz4"}""").compressorImpl)
        // A non-string id cannot be dispatched on
        assertThrows[IllegalArgumentException](headerWithCompressor("""{"id": 5}""").compressorImpl)
      }

      "throw for a zstd compressor without an int level" in
        assertThrows[IllegalArgumentException](headerWithCompressor("""{"id": "zstd"}""").compressorImpl)
    }

    "exposing a webknossos layer as zarr 2" should {

      val layer = StaticColorLayer(
        name = "color",
        dataFormat = DataFormat.zarr,
        // Non-zero topLeft, so that the shape extension for datasets that do not start at 0 is covered
        boundingBox = BoundingBox(Vec3Int(64, 64, 32), 1024, 1024, 512),
        elementClass = ElementClass.uint16,
        mags = Seq(MagLocator(mag = Vec3Int.ones), MagLocator(mag = Vec3Int(2, 2, 2)))
      )

      "build a header with channel-first shape and bucket-sized chunks" in {
        val header = ZarrHeader.fromLayer(layer, Vec3Int.ones)
        assert(header.zarr_format == 2)
        assert(header.shape.sameElements(Array(1L, 1088L, 1088L, 544L)))
        assert(header.chunks.sameElements(Array(1, 32, 32, 32)))
        assert(header.dtype == "<u2")
        assert(header.order == ArrayOrder.F)
        assert(header.compressor.isEmpty) // data requests always decompress before sending
        assert(header.resolvedDataType == ArrayDataType.u2)
      }

      "divide the shape by the mag" in {
        val header = ZarrHeader.fromLayer(layer, Vec3Int(2, 2, 2))
        assert(header.shape.sameElements(Array(1L, 544L, 544L, 272L)))
        assert(header.chunks.sameElements(Array(1, 32, 32, 32)))
      }

      "survive a writes/reads round trip" in {
        val header = ZarrHeader.fromLayer(layer, Vec3Int.ones)
        val roundTripped = parseHeader(Json.stringify(Json.toJson(header)))
        assert(roundTripped.zarr_format == header.zarr_format)
        assert(roundTripped.shape.sameElements(header.shape))
        assert(roundTripped.chunks.sameElements(header.chunks))
        assert(roundTripped.dtype == header.dtype)
        assert(roundTripped.order == header.order)
        assert(roundTripped.dimension_separator == header.dimension_separator)
        assert(roundTripped.fill_value == header.fill_value)
        assert(roundTripped.compressor.isEmpty)
        assert(roundTripped.filters.isEmpty)
        assert(roundTripped.resolvedDataType == header.resolvedDataType)
        assert(roundTripped.byteOrder == header.byteOrder)
      }
    }
  }

}
