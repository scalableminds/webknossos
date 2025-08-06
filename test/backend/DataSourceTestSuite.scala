package backend

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.Zarr3SegmentationLayer
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  DataSourceId,
  DatasetLayerAttachments,
  ElementClass,
  GenericDataSource,
  LayerAttachment,
  LayerAttachmentDataformat
}
import org.scalatestplus.play.PlaySpec

import java.net.URI

class DataSourceTestSuite extends PlaySpec {

  "DataSource" should {
    // The hashCode of a datasource is used by wk to decide if a newly scanned datasource differs from the one in the database.
    // This would break if the hashCode would become non-deterministic, for example if Arrays are used instead of Seq.
    "have deterministic hashCode" in {
      val dataSource = GenericDataSource(
        id = DataSourceId("dummyOrga", "dummyDirectoryName"),
        List(
          Zarr3SegmentationLayer(
            name = "testLayer",
            boundingBox = BoundingBox(Vec3Int(1, 2, 3), 10, 20, 30),
            elementClass = ElementClass.uint16,
            mags = List(MagLocator(mag = Vec3Int(2, 2, 1), axisOrder = Some(AxisOrder(0, 1, Some(2))))),
            largestSegmentId = Some(5),
            mappings = Some(Set("aLegacyJsonMapping")),
            defaultViewConfiguration = None,
            adminViewConfiguration = None,
            coordinateTransformations = None,
            numChannels = Some(1),
            additionalAxes = Some(Seq(AdditionalAxis("time", bounds = Seq(0, 5), 3))),
            attachments = Some(DatasetLayerAttachments(
              meshes = Seq(LayerAttachment("meshfile", new URI("./meshes/meshfile"), LayerAttachmentDataformat.zarr3))))
          )
        ),
        VoxelSize(Vec3Double(1, 3, 5.3), LengthUnit.micrometer)
      )

      val dataSourceCopyPastedFromAbove = GenericDataSource(
        id = DataSourceId("dummyOrga", "dummyDirectoryName"),
        List(
          Zarr3SegmentationLayer(
            name = "testLayer",
            boundingBox = BoundingBox(Vec3Int(1, 2, 3), 10, 20, 30),
            elementClass = ElementClass.uint16,
            mags = List(MagLocator(mag = Vec3Int(2, 2, 1), axisOrder = Some(AxisOrder(0, 1, Some(2))))),
            largestSegmentId = Some(5),
            mappings = Some(Set("aLegacyJsonMapping")),
            defaultViewConfiguration = None,
            adminViewConfiguration = None,
            coordinateTransformations = None,
            numChannels = Some(1),
            additionalAxes = Some(Seq(AdditionalAxis("time", bounds = Seq(0, 5), 3))),
            attachments = Some(DatasetLayerAttachments(
              meshes = Seq(LayerAttachment("meshfile", new URI("./meshes/meshfile"), LayerAttachmentDataformat.zarr3))))
          )
        ),
        VoxelSize(Vec3Double(1, 3, 5.3), LengthUnit.micrometer)
      )
      assert(dataSource.hashCode() == dataSourceCopyPastedFromAbove.hashCode())
    }
  }

}
