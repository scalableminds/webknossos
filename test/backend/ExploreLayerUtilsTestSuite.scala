package backend

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.n5.N5Header
import com.scalableminds.webknossos.datastore.datareaders.precomputed.PrecomputedHeader
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.explore.ExploreLayerUtils
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataFormat,
  ElementClass,
  StaticColorLayer,
  StaticLayer
}
import org.scalatest.wordspec.AsyncWordSpec

class ExploreLayerUtilsTestSuite extends AsyncWordSpec with ExploreLayerUtils {

  private def layerNamed(name: String): StaticLayer =
    StaticColorLayer(
      name = name,
      dataFormat = DataFormat.zarr3,
      boundingBox = BoundingBox(Vec3Int.zeros, 64, 64, 64),
      elementClass = ElementClass.uint8,
      mags = Seq(MagLocator(mag = Vec3Int.ones))
    )

  "Explore layer utils" when {

    "making layer names unique" should {

      "leave already unique names alone" in {
        val names = makeLayerNamesUnique(List(layerNamed("color"), layerNamed("segmentation"))).map(_.name)
        assert(names == List("color", "segmentation"))
      }

      "suffix repeated names with an index starting at 2" in {
        val names =
          makeLayerNamesUnique(List(layerNamed("color"), layerNamed("color"), layerNamed("color"))).map(_.name)
        assert(names == List("color", "color_2", "color_3"))
      }

      "skip suffixes that are taken by an explicitly named layer" in {
        val names =
          makeLayerNamesUnique(List(layerNamed("color"), layerNamed("color_2"), layerNamed("color"))).map(_.name)
        assert(names == List("color", "color_2", "color_3"))
      }

      "handle several colliding groups independently" in {
        val names = makeLayerNamesUnique(
          List(layerNamed("a"), layerNamed("b"), layerNamed("a"), layerNamed("b"), layerNamed("a"))
        ).map(_.name)
        assert(names == List("a", "b", "a_2", "b_2", "a_3"))
      }

      "keep the layer instance untouched when the name does not change" in {
        val layer = layerNamed("color")
        val result = makeLayerNamesUnique(List(layer))
        assert(result.head eq layer)
      }

      "return an empty list for an empty input" in
        assert(makeLayerNamesUnique(List()).isEmpty)
    }

    "removing header file names from a uri suffix" should {

      "strip the header file name of every supported format" in {
        assert(
          removeHeaderFileNamesFromUriSuffix(s"s3://bucket/dataset/${N5Header.FILENAME_ATTRIBUTES_JSON}")
            == "s3://bucket/dataset/"
        )
        assert(
          removeHeaderFileNamesFromUriSuffix(s"s3://bucket/dataset/color/1/${ZarrHeader.FILENAME_DOT_ZARRAY}")
            == "s3://bucket/dataset/color/1/"
        )
        assert(
          removeHeaderFileNamesFromUriSuffix(s"s3://bucket/dataset/color/${NgffMetadata.FILENAME_DOT_ZATTRS}")
            == "s3://bucket/dataset/color/"
        )
        assert(
          removeHeaderFileNamesFromUriSuffix(s"s3://bucket/dataset/${NgffGroupHeader.FILENAME_DOT_ZGROUP}")
            == "s3://bucket/dataset/"
        )
        assert(
          removeHeaderFileNamesFromUriSuffix(s"gs://bucket/dataset/${PrecomputedHeader.FILENAME_INFO}")
            == "gs://bucket/dataset/"
        )
        assert(
          removeHeaderFileNamesFromUriSuffix(s"s3://bucket/dataset/color/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}")
            == "s3://bucket/dataset/color/"
        )
      }

      "leave a uri that does not end in a header file name alone" in {
        assert(removeHeaderFileNamesFromUriSuffix("s3://bucket/dataset/color") == "s3://bucket/dataset/color")
        assert(removeHeaderFileNamesFromUriSuffix("s3://bucket/dataset/color/") == "s3://bucket/dataset/color/")
        // Only a suffix is stripped, not an occurrence in the middle
        assert(
          removeHeaderFileNamesFromUriSuffix("s3://bucket/.zarray/color") == "s3://bucket/.zarray/color"
        )
      }
    }

    "removing neuroglancer prefixes from a uri" should {

      "strip the format prefix" in {
        assert(removeNeuroglancerPrefixesFromUri("zarr3://s3://bucket/dataset") == "s3://bucket/dataset")
        assert(removeNeuroglancerPrefixesFromUri("zarr://s3://bucket/dataset") == "s3://bucket/dataset")
        assert(removeNeuroglancerPrefixesFromUri("precomputed://gs://bucket/dataset") == "gs://bucket/dataset")
        assert(removeNeuroglancerPrefixesFromUri("n5://s3://bucket/dataset") == "s3://bucket/dataset")
      }

      "leave a uri without a format prefix alone" in {
        assert(removeNeuroglancerPrefixesFromUri("https://example.com/dataset") == "https://example.com/dataset")
        assert(removeNeuroglancerPrefixesFromUri("s3://bucket/zarr://dataset") == "s3://bucket/zarr://dataset")
      }
    }
  }

}
