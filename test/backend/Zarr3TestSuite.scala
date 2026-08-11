package backend

import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.MultiArrayUtils
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  BloscCodecConfiguration,
  BytesCodecConfiguration,
  CastValueCodec,
  CastValueCodecConfiguration,
  ReshapeCodec,
  ReshapeCodecConfiguration,
  ScaleOffsetCodec,
  ScaleOffsetCodecConfiguration,
  Zarr3Array,
  Zarr3ArrayHeader
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader.Zarr3ArrayHeaderFormat
import org.scalatest.wordspec.AsyncWordSpec
import ucar.ma2.Array as MultiArray

class Zarr3TestSuite extends AsyncWordSpec {

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

    "parsing extension codecs (scale_offset, cast_value, reshape)" should {

      val zarr3json =
        """
        { "shape": [64,64,64],
          "data_type":"float32",
          "zarr_format":3,
          "chunk_grid": {"configuration": {"chunk_shape": [8,8,8]}, "name": "regular" },
          "chunk_key_encoding": { "configuration":{"separator": "/"}, "name":"default"},
          "fill_value": 0,
          "codecs":[
            {"name": "scale_offset", "configuration": {"offset": 5, "scale": 0.1}},
            {"name": "cast_value", "configuration": {"data_type": "int16"}},
            {"name": "bytes", "configuration": {"endian": "little"}},
            {"name": "blosc", "configuration": {"typesize": 2, "cname": "zstd", "clevel": 5, "shuffle": "noshuffle", "blocksize": 0}}
          ],
          "dimension_names": ["x","y","z"],
          "node_type":"array"}""".stripMargin

      "parse the codec configurations" in {
        val header = JsonHelper.parseAs[Zarr3ArrayHeader](zarr3json).get("test execution")
        assert(header.codecs.length == 4)
        assert(header.codecs(0).isInstanceOf[ScaleOffsetCodecConfiguration])
        assert(header.codecs(1).isInstanceOf[CastValueCodecConfiguration])
        val array = new Zarr3Array(null, null, null, header, null, null, null, null)
        assert(array.codecs.length == 4)
      }

      "derive stored vs. logical data type and disable the skip-typing shortcut" in {
        val header = JsonHelper.parseAs[Zarr3ArrayHeader](zarr3json).get("test execution")
        assert(header.resolvedDataType == ArrayDataType.f4)
        assert(header.storedDataType == ArrayDataType.i2) // from cast_value data_type int16
        assert(!header.isSkipTypingShortcutSupported)
      }

      "keep the skip-typing shortcut for a reshape-only chain" in {
        val reshapeJson =
          """
          { "shape": [64,64,64],
            "data_type":"uint8",
            "zarr_format":3,
            "chunk_grid": {"configuration": {"chunk_shape": [8,8,8]}, "name": "regular" },
            "chunk_key_encoding": { "configuration":{"separator": "/"}, "name":"default"},
            "fill_value": 0,
            "codecs":[
              {"name": "reshape", "configuration": {"shape": [[0,1],2]}},
              {"name": "bytes", "configuration": {"endian": "little"}}
            ],
            "node_type":"array"}""".stripMargin
        val header = JsonHelper.parseAs[Zarr3ArrayHeader](reshapeJson).get("test execution")
        assert(header.codecs(0).isInstanceOf[ReshapeCodecConfiguration])
        assert(header.storedDataType == ArrayDataType.u1)
        assert(header.isSkipTypingShortcutSupported)
      }
    }

    "decoding extension codecs" should {

      "apply scale_offset (out = in / scale + offset)" in {
        val codec = new ScaleOffsetCodec(offset = 5.0, scale = 0.1, dataType = ArrayDataType.f4)
        val input = MultiArrayUtils.createArrayWithGivenStorage(Array(1.0f, 2.0f, 3.0f), Array(3))
        val decoded = codec.decode(input)
        assert(decoded.getFloat(0) == 15.0f) // 1 / 0.1 + 5
        assert(decoded.getFloat(1) == 25.0f) // 2 / 0.1 + 5
        assert(decoded.getFloat(2) == 35.0f) // 3 / 0.1 + 5
      }

      "apply cast_value with unsigned widening (uint16 -> float32)" in {
        val codec = new CastValueCodec(sourceDataType = ArrayDataType.u2, targetDataType = ArrayDataType.f4)
        // 40000 does not fit in a signed short; stored as -25536 and must be read back unsigned.
        val input =
          MultiArrayUtils.createArrayWithGivenStorage(Array(0.toShort, 40000.toShort, 65535.toShort), Array(3))
        val decoded = codec.decode(input)
        assert(decoded.getElementType == classOf[Float])
        assert(decoded.getFloat(0) == 0.0f)
        assert(decoded.getFloat(1) == 40000.0f)
        assert(decoded.getFloat(2) == 65535.0f)
      }

      "leave data unchanged for reshape (no-op decode)" in {
        val codec = new ReshapeCodec
        val input = MultiArrayUtils.createArrayWithGivenStorage(Array[Byte](1, 2, 3, 4), Array(4))
        val decoded: MultiArray = codec.decode(input)
        assert(decoded eq input)
      }
    }
  }

}
