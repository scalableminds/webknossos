package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.inbox.GenericInboxDataSource
import play.api.libs.json._

package object datasource {

  case class DataSourceId(directoryName: String, organizationId: String) {
    override def toString: String = s"$organizationId/$directoryName"
  }

  object DataSourceId {
    // The legacy names for the directory name and organization id are "name" and "team".
    // We keep the old names in serialization and deserialization for backwards compatibility.
    implicit object DataSourceIdFormat extends Format[DataSourceId] {
      override def reads(json: JsValue): JsResult[DataSourceId] =
        (json \ "name").validate[String] flatMap { nameRenamedToPath =>
          (json \ "team").validate[String].map { teamRenamedToOrganization =>
            DataSourceId(nameRenamedToPath, teamRenamedToOrganization)
          }
        }

      override def writes(datasetId: DataSourceId): JsValue =
        Json.obj(
          "name" -> datasetId.directoryName,
          "team" -> datasetId.organizationId,
        )
    }
  }

  object DatasetViewConfiguration {
    type DatasetViewConfiguration = Map[String, JsValue]
    implicit val jsonFormat: Format[DatasetViewConfiguration] = Format.of[DatasetViewConfiguration]
  }

  case class GenericDataSource[+T <: DataLayerLike](id: DataSourceId,
                                                    dataLayers: List[T],
                                                    scale: VoxelSize,
                                                    defaultViewConfiguration: Option[DatasetViewConfiguration] = None)
      extends GenericInboxDataSource[T] {

    val toUsable: Option[GenericDataSource[T]] = Some(this)

    val voxelSizeOpt: Option[VoxelSize] = Some(scale)

    val statusOpt: Option[String] = None

    def getDataLayer(name: String): Option[T] =
      dataLayers.find(_.name == name)

    val center: Vec3Int = boundingBox.center

    lazy val boundingBox: BoundingBox =
      BoundingBox.union(dataLayers.map(_.boundingBox))

    def segmentationLayers: List[SegmentationLayer] = dataLayers.flatMap {
      case layer: SegmentationLayer => Some(layer)
      case _                        => None
    }

    def additionalAxesUnion: Option[Seq[AdditionalAxis]] =
      AdditionalAxis.merge(dataLayers.map(_.additionalAxes))

    def withUpdatedId(newId: DataSourceId): GenericDataSource[T] = copy(id = newId)

    def allExplicitPaths: Seq[String] = dataLayers.flatMap(_.allExplicitPaths)
  }

  object GenericDataSource {
    implicit def dataSourceFormat[T <: DataLayerLike](implicit fmt: Format[T]): Format[GenericDataSource[T]] =
      Json.format[GenericDataSource[T]]

    val FILENAME_DATASOURCE_PROPERTIES_JSON: String = "datasource-properties.json"
  }

  type DataSource = GenericDataSource[DataLayer]
  type DataSourceLike = GenericDataSource[DataLayerLike]
  type DataSourceWithMagLocators = GenericDataSource[DataLayerWithMagLocators]
}
