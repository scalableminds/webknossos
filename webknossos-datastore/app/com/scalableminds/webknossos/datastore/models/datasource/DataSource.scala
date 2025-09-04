package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import play.api.libs.json.{Format, JsResult, JsValue, Json}

object DatasetViewConfiguration {
  type DatasetViewConfiguration = Map[String, JsValue]
  implicit val jsonFormat: Format[DatasetViewConfiguration] = Format.of[DatasetViewConfiguration]
}

trait DataSource {
  def id: DataSourceId
  def withUpdatedId(newId: DataSourceId): DataSource

  def toUsable: Option[UsableDataSource]

  def isUsable: Boolean = toUsable.isDefined

  def voxelSizeOpt: Option[VoxelSize]

  def statusOpt: Option[String]

  def defaultViewConfiguration: Option[DatasetViewConfiguration]

  def allLayers: List[StaticLayer]
}

object DataSource {
  implicit def dataSourceFormat: Format[DataSource] =
    new Format[DataSource] {
      def reads(json: JsValue): JsResult[DataSource] = {
        UnusableDataSource.jsonFormat.reads(json).orElse(UsableDataSource.jsonFormat.reads(json))
      }

      def writes(ds: DataSource): JsValue =
        ds match {
          case ds: UsableDataSource   => UsableDataSource.jsonFormat.writes(ds)
          case ds: UnusableDataSource => UnusableDataSource.jsonFormat.writes(ds)
        }
    }
}

case class UnusableDataSource(id: DataSourceId,
                              dataLayers: Option[List[StaticLayer]] = None,
                              status: String,
                              scale: Option[VoxelSize] = None,
                              existingDataSourceProperties: Option[JsValue] = None)
    extends DataSource {
  val toUsable: Option[UsableDataSource] = None

  val voxelSizeOpt: Option[VoxelSize] = scale

  val statusOpt: Option[String] = Some(status)

  val defaultViewConfiguration: Option[DatasetViewConfiguration] = None

  def withUpdatedId(newId: DataSourceId): UnusableDataSource = copy(id = newId)

  def allLayers: List[StaticLayer] = dataLayers.getOrElse(List.empty)
}

object UnusableDataSource {
  implicit def jsonFormat: Format[UnusableDataSource] = Json.format[UnusableDataSource]
}

case class UsableDataSource(id: DataSourceId,
                            dataLayers: List[StaticLayer],
                            scale: VoxelSize,
                            defaultViewConfiguration: Option[DatasetViewConfiguration] = None,
                            statusOpt: Option[String] = None)
    extends DataSource {

  val toUsable: Option[UsableDataSource] = Some(this)

  val voxelSizeOpt: Option[VoxelSize] = Some(scale)

  def getDataLayer(name: String): Option[StaticLayer] =
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

  def withUpdatedId(newId: DataSourceId): UsableDataSource = copy(id = newId)

  def allExplicitPaths: Seq[UPath] = dataLayers.flatMap(_.allExplicitPaths)

  def allLayers: List[StaticLayer] = dataLayers

  def toUnusableWithStatus(status: String): UnusableDataSource = UnusableDataSource(
    id,
    Some(dataLayers),
    status,
    Some(scale)
  )
}

object UsableDataSource {
  implicit def jsonFormat: Format[UsableDataSource] = Json.format[UsableDataSource]

  val FILENAME_DATASOURCE_PROPERTIES_JSON: String = "datasource-properties.json"
}
