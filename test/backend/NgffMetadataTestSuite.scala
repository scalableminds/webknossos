package backend

import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.datareaders.zarr.{
  NgffGroupHeader,
  NgffLabelsGroup,
  NgffMetadata,
  NgffMetadataV0_5,
  NgffMultiscalesItemV0_5
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.NgffZarr3GroupHeader
import com.scalableminds.webknossos.datastore.models.LengthUnit
import org.scalatest.wordspec.AsyncWordSpec

class NgffMetadataTestSuite extends AsyncWordSpec {

  "OME NGFF v0.4" when {

    // Shaped after the .zattrs example of the OME-NGFF v0.4 multiscales specification
    // (https://ngff.openmicroscopy.org/0.4/#multiscale-md), for a 5-dimensional tczyx image.
    val zattrsJson = """{
      "multiscales": [
        {
          "version": "0.4",
          "name": "example",
          "axes": [
            {"name": "t", "type": "time", "unit": "millisecond"},
            {"name": "c", "type": "channel"},
            {"name": "z", "type": "space", "unit": "micrometer"},
            {"name": "y", "type": "space", "unit": "micrometer"},
            {"name": "x", "type": "space", "unit": "micrometer"}
          ],
          "datasets": [
            {
              "path": "0",
              "coordinateTransformations": [
                {"type": "scale", "scale": [1.0, 1.0, 0.5, 0.1625, 0.1625]}
              ]
            },
            {
              "path": "1",
              "coordinateTransformations": [
                {"type": "scale", "scale": [1.0, 1.0, 0.5, 0.325, 0.325]}
              ]
            },
            {
              "path": "2",
              "coordinateTransformations": [
                {"type": "scale", "scale": [1.0, 1.0, 0.5, 0.65, 0.65]},
                {"type": "translation", "translation": [0.0, 0.0, 0.0, 0.1625, 0.1625]}
              ]
            }
          ],
          "coordinateTransformations": [
            {"type": "scale", "scale": [0.1, 1.0, 1.0, 1.0, 1.0]}
          ],
          "type": "gaussian",
          "metadata": {"method": "skimage.transform.pyramid_gaussian"}
        }
      ],
      "omero": {
        "id": 1,
        "name": "example.tif",
        "version": "0.4",
        "channels": [
          {
            "active": true,
            "coefficient": 1,
            "color": "0000FF",
            "family": "linear",
            "inverted": false,
            "label": "LaminB1",
            "window": {"end": 1500, "max": 65535, "min": 0, "start": 0}
          }
        ]
      }
    }"""

    "parsing a full .zattrs" should {

      "read the multiscales item with axes and datasets" in {
        val metadata = JsonHelper.parseAs[NgffMetadata](zattrsJson).get("test execution")
        assert(metadata.multiscales.length == 1)
        val multiscale = metadata.multiscales.head
        assert(multiscale.version == "0.4")
        assert(multiscale.name.contains("example"))
        assert(multiscale.axes.map(_.name) == List("t", "c", "z", "y", "x"))
        assert(multiscale.axes.map(_.`type`) == List("time", "channel", "space", "space", "space"))
        assert(multiscale.datasets.map(_.path) == List("0", "1", "2"))
      }

      "read the coordinate transformations of the datasets" in {
        val metadata = JsonHelper.parseAs[NgffMetadata](zattrsJson).get("test execution")
        val datasets = metadata.multiscales.head.datasets
        assert(datasets.head.coordinateTransformations.length == 1)
        assert(datasets.head.coordinateTransformations.head.`type` == "scale")
        assert(datasets.head.coordinateTransformations.head.scale.contains(List(1.0, 1.0, 0.5, 0.1625, 0.1625)))
        assert(datasets.head.coordinateTransformations.head.translation.isEmpty)
        // The last mag additionally states a translation
        val lastTransformations = datasets(2).coordinateTransformations
        assert(lastTransformations.length == 2)
        assert(lastTransformations(1).`type` == "translation")
        assert(lastTransformations(1).translation.contains(List(0.0, 0.0, 0.0, 0.1625, 0.1625)))
      }

      "read the omero channel attributes" in {
        val metadata = JsonHelper.parseAs[NgffMetadata](zattrsJson).get("test execution")
        val omero = metadata.omero.get
        assert(omero.channels.length == 1)
        val channel = omero.channels.head
        assert(channel.color.contains("0000FF"))
        assert(channel.label.contains("LaminB1"))
        assert(channel.active.contains(true))
        assert(channel.inverted.contains(false))
        val window = channel.window.get
        assert(window.min == 0.0)
        assert(window.max == 65535.0)
        assert(window.start == 0.0)
        assert(window.end == 1500.0)
      }

      "convert the axis units to length units" in {
        val metadata = JsonHelper.parseAs[NgffMetadata](zattrsJson).get("test execution")
        val axes = metadata.multiscales.head.axes
        assert(axes(2).lengthUnit.toOption.contains(LengthUnit.micrometer))
        // Non-space axes have no length unit
        assert(axes(0).lengthUnit.isEmpty)
        assert(axes(1).lengthUnit.isEmpty)
      }
    }

    "omero metadata is absent" should {
      "read the multiscales without it" in {
        val minimalJson = """{
          "multiscales": [
            {
              "version": "0.4",
              "axes": [
                {"name": "z", "type": "space"},
                {"name": "y", "type": "space"},
                {"name": "x", "type": "space"}
              ],
              "datasets": [{"path": "0", "coordinateTransformations": [{"type": "scale", "scale": [40.0, 4.0, 4.0]}]}]
            }
          ]
        }"""
        val metadata = JsonHelper.parseAs[NgffMetadata](minimalJson).get("test execution")
        assert(metadata.omero.isEmpty)
        assert(metadata.multiscales.head.name.isEmpty)
        // Space axes without a unit fall back to the webknossos default unit
        assert(metadata.multiscales.head.axes.head.lengthUnit.toOption.contains(LengthUnit.nanometer))
      }
    }

    "the document is malformed" should {
      "reject it" in {
        // multiscales missing
        assert(JsonHelper.parseAs[NgffMetadata]("""{"omero": {"channels": []}}""").isEmpty)
        // datasets missing
        assert(
          JsonHelper
            .parseAs[NgffMetadata](
              """{"multiscales": [{"version": "0.4", "axes": [{"name": "x", "type": "space"}]}]}"""
            )
            .isEmpty
        )
        // an axis without a type
        assert(
          JsonHelper
            .parseAs[NgffMetadata](
              """{"multiscales": [{"version": "0.4", "axes": [{"name": "x"}], "datasets": []}]}"""
            )
            .isEmpty
        )
      }
    }

    "parsing the labels group" should {
      "read the label paths" in {
        val labelsGroup = JsonHelper
          .parseAs[NgffLabelsGroup]("""{"labels": ["cell_space_segmentation", "nuclei"]}""")
          .get("test execution")
        assert(labelsGroup.labels == List("cell_space_segmentation", "nuclei"))
      }

      "reject a document without labels" in
        assert(JsonHelper.parseAs[NgffLabelsGroup]("""{"multiscales": []}""").isEmpty)
    }

    "parsing the group header" should {
      "read the zarr format" in {
        val groupHeader = JsonHelper.parseAs[NgffGroupHeader]("""{"zarr_format": 2}""").get("test execution")
        assert(groupHeader.zarr_format == 2)
      }
    }
  }

  "OME NGFF v0.5" when {

    // Captured from the zarr.json of a webknossos-served OME NGFF v0.5 layer (trimmed to two mags).
    // In v0.5 the metadata lives under attributes.ome and the version moved out of the multiscales item.
    val zarrJson = """{
      "zarr_format": 3,
      "node_type": "group",
      "attributes": {
        "ome": {
          "version": "0.5",
          "multiscales": [
            {
              "axes": [
                {"name": "c", "type": "channel"},
                {"name": "x", "type": "space", "unit": "nanometer"},
                {"name": "y", "type": "space", "unit": "nanometer"},
                {"name": "z", "type": "space", "unit": "nanometer"}
              ],
              "datasets": [
                {
                  "path": "1",
                  "coordinateTransformations": [{"type": "scale", "scale": [1.0, 16.5, 16.5, 25.0]}]
                },
                {
                  "path": "2",
                  "coordinateTransformations": [{"type": "scale", "scale": [1.0, 33.0, 33.0, 50.0]}]
                }
              ],
              "name": "color"
            }
          ]
        }
      }
    }"""

    "parsing the zarr.json of a group" should {

      "read the metadata from attributes.ome" in {
        val groupHeader = JsonHelper.parseAs[NgffZarr3GroupHeader](zarrJson).get("test execution")
        assert(groupHeader.zarr_format == 3)
        assert(groupHeader.node_type == "group")
        assert(groupHeader.ngffMetadata.version == "0.5")
        assert(groupHeader.ngffMetadata.multiscales.length == 1)
        val multiscale = groupHeader.ngffMetadata.multiscales.head
        assert(multiscale.name.contains("color"))
        assert(multiscale.axes.map(_.name) == List("c", "x", "y", "z"))
        assert(multiscale.datasets.map(_.path) == List("1", "2"))
        assert(multiscale.datasets.head.coordinateTransformations.head.scale.contains(List(1.0, 16.5, 16.5, 25.0)))
        assert(groupHeader.ngffMetadata.omero.isEmpty)
      }

      "reject a document where the metadata is not under attributes.ome" in {
        // v0.4 puts multiscales in the toplevel of .zattrs, which must not be read as v0.5
        val v0_4StyleJson = """{
          "zarr_format": 3,
          "node_type": "group",
          "attributes": {"multiscales": []}
        }"""
        assert(JsonHelper.parseAs[NgffZarr3GroupHeader](v0_4StyleJson).isEmpty)
      }
    }

    "parsing the ome metadata on its own" should {

      val omeJson = """{
        "version": "0.5",
        "multiscales": [
          {
            "axes": [
              {"name": "c", "type": "channel"},
              {"name": "z", "type": "space", "unit": "micrometer"},
              {"name": "y", "type": "space", "unit": "micrometer"},
              {"name": "x", "type": "space", "unit": "micrometer"}
            ],
            "datasets": [
              {"path": "0", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 0.5, 0.1625, 0.1625]}]}
            ]
          }
        ],
        "omero": {
          "channels": [
            {"color": "FF0000", "label": "membrane", "active": true, "inverted": false,
             "window": {"min": 0, "max": 255, "start": 10, "end": 200}}
          ]
        }
      }"""

      "read version, multiscales and omero" in {
        val metadata = JsonHelper.parseAs[NgffMetadataV0_5](omeJson).get("test execution")
        assert(metadata.version == "0.5")
        assert(metadata.multiscales.head.name.isEmpty)
        assert(metadata.multiscales.head.axes.map(_.name) == List("c", "z", "y", "x"))
        assert(metadata.omero.get.channels.head.label.contains("membrane"))
      }

      "reject a document without a version" in
        assert(
          JsonHelper.parseAs[NgffMetadataV0_5]("""{"multiscales": [{"axes": [], "datasets": []}]}""").isEmpty
        )
    }

    "converting a v0.5 multiscales item to v0.4" should {
      // multiScalesV0_5ToV0_4 lives on NgffExplorationUtils, see NgffExplorationUtilsTestSuite
      "carry over name, axes and datasets and stamp the version" in {
        val groupHeader = JsonHelper.parseAs[NgffZarr3GroupHeader](zarrJson).get("test execution")
        val itemV0_5 = groupHeader.ngffMetadata.multiscales.head
        val itemV0_4 = NgffMultiscalesItemV0_5.asV0_4(itemV0_5)
        assert(itemV0_4.version == "0.5")
        assert(itemV0_4.name == itemV0_5.name)
        assert(itemV0_4.axes == itemV0_5.axes)
        assert(itemV0_4.datasets == itemV0_5.datasets)
      }
    }
  }

}
