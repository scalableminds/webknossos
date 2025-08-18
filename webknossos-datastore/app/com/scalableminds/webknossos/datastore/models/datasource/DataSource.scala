package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import play.api.libs.json._

object DatasetViewConfiguration {
  type DatasetViewConfiguration = Map[String, JsValue]
  implicit val jsonFormat: Format[DatasetViewConfiguration] = Format.of[DatasetViewConfiguration]
}

case class UsableDataSource(id: DataSourceId,
                            dataLayers: List[StaticLayer],
                            scale: VoxelSize,
                            defaultViewConfiguration: Option[DatasetViewConfiguration] = None,
                            statusOpt: Option[String] = None)
    extends InboxDataSource {

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

  def allExplicitPaths: Seq[String] = dataLayers.flatMap(_.allExplicitPaths)
}

object UsableDataSource {
  implicit def dataSourceFormat: Format[UsableDataSource] = Json.format[UsableDataSource]

  val FILENAME_DATASOURCE_PROPERTIES_JSON: String = "datasource-properties.json"
}
