package com.scalableminds.webknossos.datastore.datareaders

// Package must be datareaders (not the usual "backend" test package) so that this suite can call
// the package-private DatasetArray.constructOffsetAndShapeArrays directly, without faking an
// actual chunk read (which would need a real VaultPath).

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.JsonHelper
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader.Zarr3ArrayHeaderFormat
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import org.scalatest.wordspec.AsyncWordSpec

class DatasetArrayAxisOrderTestSuite extends AsyncWordSpec {

  private def parseHeader(json: String): Zarr3ArrayHeader =
    JsonHelper.parseAs[Zarr3ArrayHeader](json).get("test execution")

  // A minimal, otherwise-unused array header of the given rank (constructOffsetAndShapeArrays
  // only cares about header.rank, i.e. chunkShape.length).
  private def headerOfRank(rank: Int): Zarr3ArrayHeader =
    parseHeader(s"""{
      "shape": [${Array.fill(rank)(1).mkString(",")}],
      "data_type": "uint8",
      "zarr_format": 3,
      "chunk_grid": {"configuration": {"chunk_shape": [${Array.fill(rank)(1).mkString(",")}]}, "name": "regular"},
      "chunk_key_encoding": {"name": "default"},
      "fill_value": 0,
      "codecs": [{"configuration": {"endian": "little"}, "name": "bytes"}],
      "node_type": "array"
    }""")

  private def arrayOf(
      axisOrder: AxisOrder,
      channelIndex: Option[Int] = None,
      additionalAxes: Option[Seq[AdditionalAxis]] = None
  ): Zarr3Array = {
    val rank = axisOrder.length + additionalAxes.map(_.length).getOrElse(0)
    new Zarr3Array(null, null, null, headerOfRank(rank), axisOrder, channelIndex, additionalAxes, null)
  }

  "constructOffsetAndShapeArrays" should {

    // Repro of the "xyt" dataset from the bug report: on-disk dimension order is (x, y, z, t),
    // with "t" a genuine additional axis declared at physical/array index 3 (i.e. after x, y, z,
    // not before them). This is the case that exposed the bug: arrayToWkPermutation(3) happened
    // to collide with the wk slot of "y", so every read silently used the requested t value as a
    // y-offset instead of indexing into the t axis at all.
    "place an additional axis declared after x/y/z into its own wk slot, not into x/y/z's slot" in {
      val axisOrder = AxisOrder(x = 0, y = 1, z = Some(2))
      val additionalAxes = Some(Seq(AdditionalAxis("t", Seq(0, 101), index = 3)))
      val array = arrayOf(axisOrder, additionalAxes = additionalAxes)

      val (offset, shape) = array.constructOffsetAndShapeArrays(
        Vec3Int(16, 48, 0),
        Vec3Int(32, 32, 1),
        Some(Seq(AdditionalCoordinate("t", 100))),
        shouldReadUint24 = false
      )

      // wk order here is (t, x, y, z): the additional axis occupies slot 0, followed by x, y, z.
      assert(offset.sameElements(Array(100, 16, 48, 0)))
      assert(shape.sameElements(Array(1, 32, 32, 1)))
    }

    // Same idea, but for the channel axis: a layout where "c" is not at its usual wk-canonical
    // position (array order x, y, c, z instead of c, x, y, z) exposes the identical bug, since
    // axisOrder.c is a physical/array index just like AdditionalAxis.index.
    "place the channel axis into its own wk slot, not into x/y/z's slot" in {
      val axisOrder = AxisOrder(x = 0, y = 1, z = Some(3), c = Some(2))
      val array = arrayOf(axisOrder, channelIndex = Some(7))

      val (offset, shape) = array.constructOffsetAndShapeArrays(
        Vec3Int(9, 20, 0),
        Vec3Int(1, 1, 1),
        additionalCoordinatesOpt = None,
        shouldReadUint24 = false
      )

      // wk order here is (c, x, y, z): the channel occupies slot 0, followed by x, y, z.
      assert(offset.sameElements(Array(7, 9, 20, 0)))
      assert(shape.sameElements(Array(1, 1, 1, 1)))
    }

    // Control case matching the vast majority of real datasets (no additional axes, channel-first
    // xyz layout): array and wk order coincide, so this passed even with the old, buggy code.
    "leave offsets untouched for a plain c,x,y,z layout with no additional axes" in {
      val axisOrder = AxisOrder.cxyz
      val array = arrayOf(axisOrder, channelIndex = Some(2))

      val (offset, _) = array.constructOffsetAndShapeArrays(
        Vec3Int(5, 6, 7),
        Vec3Int(32, 32, 32),
        additionalCoordinatesOpt = None,
        shouldReadUint24 = false
      )

      assert(offset.sameElements(Array(2, 5, 6, 7)))
    }
  }

}
