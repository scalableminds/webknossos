package backend

import com.scalableminds.util.box.Full
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{Zarr3OutputHelper, ZarrCoordinatesParser}
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffMetadata, NgffMetadataV0_5, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  ChunkGridSpecification,
  TransposeCodecConfiguration,
  Zarr3ArrayHeader
}
import com.scalableminds.webknossos.datastore.geometry.{AdditionalAxisProto, Vec2IntProto}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, ElementClass}
import org.scalatest.wordspec.AsyncWordSpec

// Zarr streaming of layers and volume tracings with additional axes: the served .zarray/zarr.json must describe arrays
// whose chunk keys are accepted by ZarrCoordinatesParser (as used by the rawZarrCube endpoints).
class ZarrStreamingAdditionalAxesTestSuite extends AsyncWordSpec with Zarr3OutputHelper {

  private val boundingBox = BoundingBox(Vec3Int(64, 64, 32), 1024, 1024, 512)

  // Like a volume tracing inheriting a singleton t axis from its dataset
  private val singletonTAxis = AdditionalAxis.fromProtos(Seq(AdditionalAxisProto("t", 0, Vec2IntProto(0, 1))))

  // Axes whose listing order differs from their index order
  private val unorderedAxes = AdditionalAxis.fromProtos(
    Seq(AdditionalAxisProto("t", 2, Vec2IntProto(0, 5)), AdditionalAxisProto("angle", 1, Vec2IntProto(0, 3)))
  )

  "Zarr 2 header for an array with additional axes" should {

    "include a singleton additional axis in shape and chunks" in {
      val header = ZarrHeader.forArray(ElementClass.uint32, boundingBox, singletonTAxis, Vec3Int.ones)
      assert(header.shape.sameElements(Array(1L, 1L, 1088L, 1088L, 544L)))
      assert(header.chunks.sameElements(Array(1, 1, 32, 32, 32)))
    }

    "order additional axes by their index" in {
      val header = ZarrHeader.forArray(ElementClass.uint32, boundingBox, unorderedAxes, Vec3Int(2, 2, 2))
      assert(header.shape.sameElements(Array(1L, 3L, 5L, 544L, 544L, 272L)))
      assert(header.chunks.sameElements(Array(1, 1, 1, 32, 32, 32)))
    }

    "keep the 4D layout without additional axes" in {
      val header = ZarrHeader.forArray(ElementClass.uint32, boundingBox, Seq.empty, Vec3Int.ones)
      assert(header.shape.sameElements(Array(1L, 1088L, 1088L, 544L)))
      assert(header.chunks.sameElements(Array(1, 32, 32, 32)))
    }
  }

  "Zarr 3 header for an array with additional axes" should {

    "include a singleton additional axis in shape, chunks and dimension names" in {
      val header = Zarr3ArrayHeader.forArray(ElementClass.uint32, boundingBox, singletonTAxis, Vec3Int.ones)
      assert(header.shape.sameElements(Array(1L, 1L, 1088L, 1088L, 544L)))
      header.chunk_grid match {
        case Left(ChunkGridSpecification(_, configuration)) =>
          assert(configuration.chunk_shape.sameElements(Array(1, 1, 32, 32, 32)))
        case Right(_) => fail("expected regular chunk grid")
      }
      assert(header.dimension_names.exists(_.sameElements(Array("c", "t", "x", "y", "z"))))
      assert(header.codecs.collectFirst { case t: TransposeCodecConfiguration => t }.isDefined)
      assert(header.rank == 5)
    }

    "order additional axes by their index" in {
      val header = Zarr3ArrayHeader.forArray(ElementClass.uint32, boundingBox, unorderedAxes, Vec3Int.ones)
      assert(header.shape.sameElements(Array(1L, 3L, 5L, 1088L, 1088L, 544L)))
      assert(header.dimension_names.exists(_.sameElements(Array("c", "angle", "t", "x", "y", "z"))))
    }
  }

  "OME-NGFF metadata for an array with additional axes" should {

    val voxelSize = VoxelSize(Vec3Double(11, 11, 24), LengthUnit.nanometer)
    val mags = Seq(Vec3Int.ones, Vec3Int(2, 2, 1))

    "match the array rank in axes and scales (v0.4, .zattrs)" in {
      val header = ZarrHeader.forArray(ElementClass.uint32, boundingBox, singletonTAxis, Vec3Int.ones)
      val multiscales =
        NgffMetadata.fromNameVoxelSizeAndMags("layer", voxelSize, mags, Some(singletonTAxis)).multiscales
      assert(multiscales.head.axes.length == header.rank)
      assert(
        multiscales.head.datasets.flatMap(_.coordinateTransformations).forall(_.scale.exists(_.length == header.rank))
      )
      assert(
        multiscales.head.datasets(1).coordinateTransformations.head.scale.contains(List(1.0, 1.0, 22.0, 22.0, 24.0))
      )
    }

    "match the array rank in axes and scales (v0.5, zarr.json)" in {
      val header = Zarr3ArrayHeader.forArray(ElementClass.uint32, boundingBox, unorderedAxes, Vec3Int.ones)
      val multiscales =
        NgffMetadataV0_5.fromNameVoxelSizeAndMags("layer", voxelSize, mags, Some(unorderedAxes)).multiscales
      assert(multiscales.head.axes.length == header.rank)
      assert(
        multiscales.head.datasets.flatMap(_.coordinateTransformations).forall(_.scale.exists(_.length == header.rank))
      )
      // Axis names must match the zarr 3 dimension_names
      assert(header.dimension_names.exists(_.sameElements(multiscales.head.axes.map(_.name))))
      // Only xyz are space axes, the additional ones have no length unit
      assert(multiscales.head.axes.filter(_.`type` == "space").map(_.name) == List("x", "y", "z"))
      assert(multiscales.head.axes.slice(1, 3).forall(_.unit.isEmpty))
    }

    "keep four axes without additional axes" in {
      val multiscales = NgffMetadata.fromNameVoxelSizeAndMags("layer", voxelSize, mags).multiscales
      assert(multiscales.head.axes.map(_.name) == List("c", "x", "y", "z"))
      assert(multiscales.head.datasets.head.coordinateTransformations.head.scale.contains(List(1.0, 11.0, 11.0, 24.0)))
    }
  }

  "Chunk keys of the served arrays" should {

    "be accepted by the coordinates parser for a singleton additional axis" in {
      val header = ZarrHeader.forArray(ElementClass.uint32, boundingBox, singletonTAxis, Vec3Int.ones)
      val chunkKey = Seq.fill(header.rank - 3)(0).mkString(".") + ".33.27.4"
      ZarrCoordinatesParser
        .parseNDimensionalDotCoordinates(chunkKey, Some(reorderAdditionalAxes(singletonTAxis)))
        .futureBox
        .map(result => assert(result == Full((33, 27, 4, Some(List(AdditionalCoordinate("t", 0)))))))
    }

    "map additional coordinates in index order" in
      ZarrCoordinatesParser
        .parseNDimensionalDotCoordinates("0.2.4.1.1.1", Some(reorderAdditionalAxes(unorderedAxes)))
        .futureBox
        .map(result =>
          assert(
            result == Full((1, 1, 1, Some(List(AdditionalCoordinate("angle", 2), AdditionalCoordinate("t", 4)))))
          )
        )

    "reject 4D chunk keys for an array with additional axes" in
      ZarrCoordinatesParser
        .parseNDimensionalDotCoordinates("0.33.27.4", Some(reorderAdditionalAxes(singletonTAxis)))
        .futureBox
        .map(result => assert(result.isEmpty))
  }

}
