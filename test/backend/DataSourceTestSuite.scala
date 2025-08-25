package backend

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  DataFormat,
  DataLayerAttachments,
  DataSourceId,
  ElementClass,
  LayerAttachment,
  LayerAttachmentDataformat,
  StaticSegmentationLayer,
  UsableDataSource
}
import org.scalatestplus.play.PlaySpec

import java.net.URI

class DataSourceTestSuite extends PlaySpec {

  "DataSource" should {
    // The hashCode of a datasource is used by wk to decide if a newly scanned datasource differs from the one in the database.
    // This would break if the hashCode would become non-deterministic, for example if Arrays are used instead of Seq.
    "have deterministic hashCode" in {
      val dataSource = UsableDataSource(
        id = DataSourceId("dummyOrga", "dummyDirectoryName"),
        List(
          StaticSegmentationLayer(
            name = "testLayer",
            dataFormat = DataFormat.zarr3,
            boundingBox = BoundingBox(Vec3Int(1, 2, 3), 10, 20, 30),
            elementClass = ElementClass.uint16,
            mags = List(MagLocator(mag = Vec3Int(2, 2, 1), axisOrder = Some(AxisOrder(0, 1, Some(2))))),
            largestSegmentId = Some(5),
            mappings = Some(Set("aLegacyJsonMapping")),
            defaultViewConfiguration = None,
            adminViewConfiguration = None,
            coordinateTransformations = None,
            additionalAxes = Some(Seq(AdditionalAxis("time", bounds = Seq(0, 5), 3))),
            attachments = Some(
              DataLayerAttachments(
                meshes = Seq(LayerAttachment("meshfile",
                                             UPath.fromStringUnsafe("./meshes/meshfile"),
                                             LayerAttachmentDataformat.zarr3))))
          )
        ),
        VoxelSize(Vec3Double(1, 3, 5.3), LengthUnit.micrometer)
      )

      val dataSourceCopyPastedFromAbove = UsableDataSource(
        id = DataSourceId("dummyOrga", "dummyDirectoryName"),
        List(
          StaticSegmentationLayer(
            name = "testLayer",
            dataFormat = DataFormat.zarr3,
            boundingBox = BoundingBox(Vec3Int(1, 2, 3), 10, 20, 30),
            elementClass = ElementClass.uint16,
            mags = List(MagLocator(mag = Vec3Int(2, 2, 1), axisOrder = Some(AxisOrder(0, 1, Some(2))))),
            largestSegmentId = Some(5),
            mappings = Some(Set("aLegacyJsonMapping")),
            defaultViewConfiguration = None,
            adminViewConfiguration = None,
            coordinateTransformations = None,
            additionalAxes = Some(Seq(AdditionalAxis("time", bounds = Seq(0, 5), 3))),
            attachments = Some(
              DataLayerAttachments(
                meshes = Seq(LayerAttachment("meshfile",
                                             UPath.fromStringUnsafe("./meshes/meshfile"),
                                             LayerAttachmentDataformat.zarr3))))
          )
        ),
        VoxelSize(Vec3Double(1, 3, 5.3), LengthUnit.micrometer)
      )
      assert(dataSource.hashCode() == dataSourceCopyPastedFromAbove.hashCode())
    }
  }

}
