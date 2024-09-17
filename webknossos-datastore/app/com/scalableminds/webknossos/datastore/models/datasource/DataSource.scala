package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.requestparsing.{DatasetURIParser, ObjectId}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.inbox.GenericInboxDataSource
import play.api.libs.json._

package object datasource {

  // here team is not (yet) renamed to organization to avoid migrating all jsons
  case class LegacyDataSourceId(name: String, team: String) extends DatasetURIParser {
    override def toString: String = s"DataSourceId($team/$name)"
  }

  object LegacyDataSourceId extends DatasetURIParser {
    implicit val dataSourceIdFormat: Format[LegacyDataSourceId] = Json.format[LegacyDataSourceId]

    def fromDatasetNameAndIdAndOrganizationId(datasetNameAndId: String, organizationId: String): LegacyDataSourceId = {
      val (maybeId, maybeDatasetName) = getDatasetIdOrNameFromURIPath(datasetNameAndId)
      maybeId match {
        case Some(validId) => LegacyDataSourceId(validId.toString, organizationId)
        case None          => LegacyDataSourceId(maybeDatasetName.getOrElse(datasetNameAndId), organizationId)
      }
    }
    def fromDatasetIdOrNameAndOrganizationId(datasetIdOrName: String, organizationId: String): LegacyDataSourceId = {
      val parsedId = ObjectId.fromStringSync(datasetIdOrName)
      parsedId match {
        case Some(validId) => LegacyDataSourceId(validId.toString, organizationId)
        case None          => LegacyDataSourceId(datasetIdOrName, organizationId)
      }
    }
  }

  case class DatasetIdWithPath(id: ObjectId, path: String) {
    override def toString: String = s"DatasetIdWithPath($id, $path)"
  }

  object DatasetIdWithPath {
    implicit val datasetIdWithPathFormat: Format[DatasetIdWithPath] = Json.format[DatasetIdWithPath]
  }

  object DatasetViewConfiguration {
    type DatasetViewConfiguration = Map[String, JsValue]
    implicit val jsonFormat: Format[DatasetViewConfiguration] = Format.of[DatasetViewConfiguration]
  }

  case class GenericDataSource[+T <: DataLayerLike](id: LegacyDataSourceId,
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
