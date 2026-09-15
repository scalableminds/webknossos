package backend

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.{
  NgffAxis,
  NgffChannelAttributes,
  NgffChannelWindow,
  NgffCoordinateTransformation,
  NgffDataset,
  NgffMetadataV0_5,
  NgffMultiscalesItem,
  NgffOmeroMetadata
}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.explore.NgffExplorationUtils
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.{ElementClass, StaticLayer}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.{JsBoolean, JsNumber, Json}

/*
 * The helpers under test are protected members of NgffExplorationUtils, so the suite mixes the trait in.
 * The abstract members of the trait all need a VaultPath (and therefore network access) and are not exercised here.
 */
class NgffExplorationUtilsTestSuite extends AsyncWordSpec with NgffExplorationUtils {

  override protected def getShape(dataset: NgffDataset, path: VaultPath)(using tc: TokenContext): Fox[Array[Long]] = ???

  override protected def createLayer(
      remotePath: VaultPath,
      credentialId: Option[String],
      multiscale: NgffMultiscalesItem,
      channelIndex: Int,
      channelAttributes: Option[Seq[ChannelAttributes]],
      datasetName: String,
      voxelSizeInAxisUnits: Vec3Double,
      axisOrder: AxisOrder,
      isSegmentation: Boolean
  )(using tc: TokenContext): Fox[StaticLayer] = ???

  override protected def layersForLabel(remotePath: VaultPath, labelPath: String, credentialId: Option[String])(using
      tc: TokenContext
  ): Fox[List[(StaticLayer, VoxelSize)]] = ???

  private def spaceAxis(name: String, unit: Option[String] = Some("nanometer")): NgffAxis =
    NgffAxis(name = name, `type` = "space", unit = unit)

  private def channelAxis: NgffAxis = NgffAxis(name = "c", `type` = "channel")

  private def scaleTransform(scale: List[Double]): NgffCoordinateTransformation =
    NgffCoordinateTransformation(`type` = "scale", scale = Some(scale), translation = None)

  "Ngff exploration utils" when {

    "extracting the axis order" should {

      "read a plain xyz axis list" in
        extractAxisOrder(List(spaceAxis("x"), spaceAxis("y"), spaceAxis("z"))).futureBox.map {
          case Full(axisOrder) => assert(axisOrder == AxisOrder(0, 1, Some(2), None))
          case other           => fail(s"expected Full, got $other")
        }

      "read an xyzc axis list" in
        extractAxisOrder(List(spaceAxis("x"), spaceAxis("y"), spaceAxis("z"), channelAxis)).futureBox.map {
          case Full(axisOrder) => assert(axisOrder == AxisOrder(0, 1, Some(2), Some(3)))
          case other           => fail(s"expected Full, got $other")
        }

      "read a cxyz axis list" in
        extractAxisOrder(List(channelAxis, spaceAxis("x"), spaceAxis("y"), spaceAxis("z"))).futureBox.map {
          case Full(axisOrder) => assert(axisOrder == AxisOrder(1, 2, Some(3), Some(0)))
          case other           => fail(s"expected Full, got $other")
        }

      "read an axis list without a z axis" in
        extractAxisOrder(List(channelAxis, spaceAxis("y"), spaceAxis("x"))).futureBox.map {
          case Full(axisOrder) =>
            assert(axisOrder == AxisOrder(2, 1, None, Some(0)))
            assert(!axisOrder.hasZAxis)
            assert(axisOrder.zWithFallback == 3)
          case other => fail(s"expected Full, got $other")
        }

      "be case insensitive in the axis names" in
        extractAxisOrder(List(spaceAxis("X"), spaceAxis("Y"), spaceAxis("Z"))).futureBox.map {
          case Full(axisOrder) => assert(axisOrder == AxisOrder(0, 1, Some(2), None))
          case other           => fail(s"expected Full, got $other")
        }

      "fail when the x axis is missing" in
        extractAxisOrder(List(spaceAxis("y"), spaceAxis("z"))).futureBox.map {
          case _: Failure => succeed
          case other      => fail(s"expected Failure, got $other")
        }

      "fail when the y axis is missing" in
        extractAxisOrder(List(spaceAxis("x"), spaceAxis("z"))).futureBox.map {
          case _: Failure => succeed
          case other      => fail(s"expected Failure, got $other")
        }

      "fail when x and y are not space axes" in
        // A time-typed axis called x must not be mistaken for the x axis
        extractAxisOrder(List(NgffAxis("x", "time", None), NgffAxis("y", "time", None))).futureBox.map {
          case _: Failure => succeed
          case other      => fail(s"expected Failure, got $other")
        }
    }

    "extracting the mag from coordinate transforms" should {

      val axisOrder = AxisOrder(1, 2, Some(3), Some(0))

      "read a power-of-two mag" in
        magFromTransforms(
          List(scaleTransform(List(1.0, 8.0, 8.0, 16.0))),
          voxelSizeInAxisUnits = Vec3Double(4.0, 4.0, 8.0),
          axisOrder
        ).futureBox.map {
          case Full(mag) => assert(mag == Vec3Int(2, 2, 2))
          case other     => fail(s"expected Full, got $other")
        }

      "read mag 1 for the finest scale" in
        magFromTransforms(
          List(scaleTransform(List(1.0, 4.0, 4.0, 8.0))),
          voxelSizeInAxisUnits = Vec3Double(4.0, 4.0, 8.0),
          axisOrder
        ).futureBox.map {
          case Full(mag) => assert(mag == Vec3Int(1, 1, 1))
          case other     => fail(s"expected Full, got $other")
        }

      "multiply several scale transforms" in
        magFromTransforms(
          List(scaleTransform(List(1.0, 2.0, 2.0, 2.0)), scaleTransform(List(1.0, 4.0, 4.0, 4.0))),
          voxelSizeInAxisUnits = Vec3Double(4.0, 4.0, 4.0),
          axisOrder
        ).futureBox.map {
          case Full(mag) => assert(mag == Vec3Int(2, 2, 2))
          case other     => fail(s"expected Full, got $other")
        }

      "ignore translation transforms" in
        magFromTransforms(
          List(
            scaleTransform(List(1.0, 8.0, 8.0, 8.0)),
            NgffCoordinateTransformation("translation", None, Some(List(0.0, 10.0, 10.0, 10.0)))
          ),
          voxelSizeInAxisUnits = Vec3Double(4.0, 4.0, 4.0),
          axisOrder
        ).futureBox.map {
          case Full(mag) => assert(mag == Vec3Int(2, 2, 2))
          case other     => fail(s"expected Full, got $other")
        }

      "fail for a mag that is not a power of two" in
        magFromTransforms(
          List(scaleTransform(List(1.0, 12.0, 12.0, 12.0))),
          voxelSizeInAxisUnits = Vec3Double(4.0, 4.0, 4.0),
          axisOrder
        ).futureBox.map {
          case Failure(msg, _, _) => assert(msg.contains("Must all be powers of two"))
          case other              => fail(s"expected Failure, got $other")
        }
    }

    "extracting the voxel size in axis units" should {

      val axisOrder = AxisOrder(1, 2, Some(3), Some(0))

      "use the smallest scale when the scales agree on it" in
        extractVoxelSizeInAxisUnits(
          List(
            List(scaleTransform(List(1.0, 4.0, 4.0, 40.0))),
            List(scaleTransform(List(1.0, 8.0, 8.0, 40.0))),
            List(scaleTransform(List(1.0, 16.0, 16.0, 80.0)))
          ),
          axisOrder
        ).futureBox.map {
          case Full(voxelSize) => assert(voxelSize == Vec3Double(4.0, 4.0, 40.0))
          case other           => fail(s"expected Full, got $other")
        }

      "fail when the scales do not agree on the smallest dimension" in
        extractVoxelSizeInAxisUnits(
          List(
            List(scaleTransform(List(1.0, 4.0, 8.0, 40.0))),
            List(scaleTransform(List(1.0, 8.0, 4.0, 40.0)))
          ),
          axisOrder
        ).futureBox.map {
          case Failure(msg, _, _) => assert(msg.contains("do not agree on smallest dimension"))
          case other              => fail(s"expected Failure, got $other")
        }

      "treat a missing z axis as scale 1" in
        extractVoxelSizeInAxisUnits(
          List(List(scaleTransform(List(1.0, 4.0, 4.0)))),
          AxisOrder(1, 2, None, Some(0))
        ).futureBox.map {
          case Full(voxelSize) => assert(voxelSize == Vec3Double(4.0, 4.0, 1.0))
          case other           => fail(s"expected Full, got $other")
        }
    }

    "extracting the axis unit factors" should {

      "convert mixed length units to the unified unit" in {
        val axes = List(spaceAxis("x", Some("µm")), spaceAxis("y", Some("nm")), spaceAxis("z", Some("mm")))
        extractAxisUnitFactors(LengthUnit.nanometer, axes, AxisOrder(0, 1, Some(2), None)).futureBox.map {
          case Full(factors) => assert(factors == Vec3Double(1000.0, 1.0, 1000000.0))
          case other         => fail(s"expected Full, got $other")
        }
      }

      "accept the long unit names" in {
        val axes = List(
          spaceAxis("x", Some("micrometer")),
          spaceAxis("y", Some("micrometer")),
          spaceAxis("z", Some("nanometer"))
        )
        extractAxisUnitFactors(LengthUnit.nanometer, axes, AxisOrder(0, 1, Some(2), None)).futureBox.map {
          case Full(factors) => assert(factors == Vec3Double(1000.0, 1000.0, 1.0))
          case other         => fail(s"expected Full, got $other")
        }
      }

      "convert to a unified unit that is not nanometer" in {
        val axes = List(spaceAxis("x", Some("nm")), spaceAxis("y", Some("nm")), spaceAxis("z", Some("µm")))
        extractAxisUnitFactors(LengthUnit.micrometer, axes, AxisOrder(0, 1, Some(2), None)).futureBox.map {
          case Full(factors) => assert(factors == Vec3Double(0.001, 0.001, 1.0))
          case other         => fail(s"expected Full, got $other")
        }
      }

      "default absent units to nanometer" in {
        val axes = List(spaceAxis("x", None), spaceAxis("y", Some("")), spaceAxis("z", None))
        extractAxisUnitFactors(LengthUnit.nanometer, axes, AxisOrder(0, 1, Some(2), None)).futureBox.map {
          case Full(factors) => assert(factors == Vec3Double(1.0, 1.0, 1.0))
          case other         => fail(s"expected Full, got $other")
        }
      }

      "use factor 1 for z when there is no z axis" in {
        val axes = List(spaceAxis("x", Some("µm")), spaceAxis("y", Some("µm")))
        extractAxisUnitFactors(LengthUnit.nanometer, axes, AxisOrder(0, 1, None, None)).futureBox.map {
          case Full(factors) => assert(factors == Vec3Double(1000.0, 1000.0, 1.0))
          case other         => fail(s"expected Full, got $other")
        }
      }

      "not yield a value for an unknown unit" in {
        val axes = List(spaceAxis("x", Some("furlong")), spaceAxis("y", Some("nm")), spaceAxis("z", Some("nm")))
        extractAxisUnitFactors(LengthUnit.nanometer, axes, AxisOrder(0, 1, Some(2), None)).futureBox.map {
          case Empty      => succeed
          case _: Failure => succeed
          case other      => fail(s"expected Empty or Failure, got $other")
        }
      }
    }

    "ensuring the element class of a segmentation layer" should {
      "map signed integers to their unsigned counterpart" in {
        assert(ensureElementClassForSegmentationLayer(ElementClass.int8) == ElementClass.uint8)
        assert(ensureElementClassForSegmentationLayer(ElementClass.int16) == ElementClass.uint16)
        assert(ensureElementClassForSegmentationLayer(ElementClass.int32) == ElementClass.uint32)
        assert(ensureElementClassForSegmentationLayer(ElementClass.int64) == ElementClass.uint64)
      }

      "leave every other element class alone" in {
        assert(ensureElementClassForSegmentationLayer(ElementClass.uint8) == ElementClass.uint8)
        assert(ensureElementClassForSegmentationLayer(ElementClass.uint32) == ElementClass.uint32)
        assert(ensureElementClassForSegmentationLayer(ElementClass.float) == ElementClass.float)
        assert(ensureElementClassForSegmentationLayer(ElementClass.uint24) == ElementClass.uint24)
      }
    }

    "parsing the channel attributes" should {

      "derive view configuration and name from the omero metadata" in {
        val omero = NgffOmeroMetadata(
          channels = List(
            NgffChannelAttributes(
              Some("FF0000"),
              Some("Channel 1"),
              Some(NgffChannelWindow(min = 0, max = 255, start = 10, end = 200)),
              Some(false),
              Some(true)
            )
          )
        )
        val channelAttributes = getChannelAttributes(Some(omero))
        val (viewConfiguration, name) = parseChannelAttributes(channelAttributes, "someDataset", 0)
        // Spaces are removed from the omero label
        assert(name == "Channel1")
        assert(viewConfiguration("color") == Json.arr(255, 0, 0))
        assert(viewConfiguration("intensityRange") == Json.arr(JsNumber(10.0), JsNumber(200.0)))
        assert(viewConfiguration("min") == JsNumber(0.0))
        assert(viewConfiguration("max") == JsNumber(255.0))
        assert(viewConfiguration("isInverted") == JsBoolean(false))
        // active=true means not disabled
        assert(viewConfiguration("isDisabled") == JsBoolean(false))
      }

      "fall back to the dataset name for a channel without a label" in {
        val omero = NgffOmeroMetadata(channels = List(NgffChannelAttributes(Some("00FF00"), None, None, None, None)))
        val channelAttributes = getChannelAttributes(Some(omero))
        val (viewConfiguration, name) = parseChannelAttributes(channelAttributes, "someDataset", 0)
        assert(name == "someDataset")
        assert(viewConfiguration.keySet == Set("color"))
        assert(viewConfiguration("color") == Json.arr(0, 255, 0))
      }

      "select the attributes of the requested channel" in {
        val omero = NgffOmeroMetadata(
          channels = List(
            NgffChannelAttributes(None, Some("first"), None, None, None),
            NgffChannelAttributes(None, Some("second"), None, None, None)
          )
        )
        val channelAttributes = getChannelAttributes(Some(omero))
        val (viewConfiguration, name) = parseChannelAttributes(channelAttributes, "someDataset", 1)
        assert(name == "second")
        // A channel without any renderable attribute yields an empty view configuration
        assert(viewConfiguration.isEmpty)
      }

      "fall back to the dataset name when there is no omero metadata" in {
        assert(getChannelAttributes(None).isEmpty)
        val (viewConfiguration, name) = parseChannelAttributes(None, "someDataset", 0)
        assert(viewConfiguration.isEmpty)
        assert(name == "someDataset")
      }
    }

    "converting a v0.5 multiscales item to v0.4" should {
      "carry over name, axes and datasets and stamp the version" in {
        val omeJson = """{
          "version": "0.5",
          "multiscales": [
            {
              "name": "color",
              "axes": [
                {"name": "c", "type": "channel"},
                {"name": "x", "type": "space", "unit": "nanometer"},
                {"name": "y", "type": "space", "unit": "nanometer"},
                {"name": "z", "type": "space", "unit": "nanometer"}
              ],
              "datasets": [
                {"path": "1", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 16.5, 16.5, 25.0]}]},
                {"path": "2", "coordinateTransformations": [{"type": "scale", "scale": [1.0, 33.0, 33.0, 50.0]}]}
              ]
            }
          ]
        }"""
        val itemV0_5 = JsonHelper.parseAs[NgffMetadataV0_5](omeJson).get("test execution").multiscales.head
        val itemV0_4 = multiScalesV0_5ToV0_4(itemV0_5)
        assert(itemV0_4.version == "0.5")
        assert(itemV0_4.name == itemV0_5.name)
        assert(itemV0_4.axes == itemV0_5.axes)
        assert(itemV0_4.datasets == itemV0_5.datasets)
      }
    }
  }

}
