package backend

import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  BloscCodecConfiguration,
  BytesCodecConfiguration,
  Zarr3Array
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader.Zarr3ArrayHeaderFormat
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.Json
import spire.math.Number

class Zarr3TestSuite extends PlaySpec {

  "Zarr 3" when {
    "importing zarr.json" should {

      val zarr3json = Json.parse(
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
          "node_type":"array"}""".stripMargin)

      "read correct basic header data" in {
        val header = Zarr3ArrayHeaderFormat.reads(zarr3json).get
        assert(header.shape.sameElements(Seq(64, 64, 64)))
        assert(header.data_type.left.getOrElse("notUint8") == "uint8")
        assert(header.zarr_format == 3)
        assert(header.fill_value.getOrElse(Number(1)).intValue() == 0)
        assert(header.dimension_names.get.sameElements(Seq("x", "y", "z")))
      }

      "parse basic codecs" in {
        val header = Zarr3ArrayHeaderFormat.reads(zarr3json).get
        assert(header.codecs.length == 2)
        assert(header.codecs(0).isInstanceOf[BytesCodecConfiguration])
        assert(header.codecs(1).isInstanceOf[BloscCodecConfiguration])
        val array = new Zarr3Array(null, null, null, header, null, null, null, null)
        assert(array.codecs.length == 2)
      }
    }
  }

}
