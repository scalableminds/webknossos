package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.VoxelSize
import play.api.libs.json.{Format, JsResult, JsValue, Json}

trait InboxDataSource {

  def id: DataSourceId
  def withUpdatedId(newId: DataSourceId): InboxDataSource

  def toUsable: Option[UsableDataSource]

  def isUsable: Boolean = toUsable.isDefined

  def voxelSizeOpt: Option[VoxelSize]

  def statusOpt: Option[String]

  def defaultViewConfiguration: Option[DatasetViewConfiguration]

  def withoutCredentials: InboxDataSource
}

object InboxDataSource {
  implicit def inboxDataSourceFormat: Format[InboxDataSource] =
    new Format[InboxDataSource] {
      def reads(json: JsValue): JsResult[InboxDataSource] =
        UsableDataSource.dataSourceFormat.reads(json).orElse(UnusableDataSource.unusableDataSourceFormat.reads(json))

      def writes(ds: InboxDataSource): JsValue =
        ds match {
          case ds: UsableDataSource   => UsableDataSource.dataSourceFormat.writes(ds)
          case ds: UnusableDataSource => UnusableDataSource.unusableDataSourceFormat.writes(ds)
        }
    }
}

case class UnusableDataSource(id: DataSourceId,
                              status: String,
                              scale: Option[VoxelSize] = None,
                              existingDataSourceProperties: Option[JsValue] = None)
    extends InboxDataSource {
  val toUsable: Option[UsableDataSource] = None

  val voxelSizeOpt: Option[VoxelSize] = scale

  val statusOpt: Option[String] = Some(status)

  val defaultViewConfiguration: Option[DatasetViewConfiguration] = None

  def withUpdatedId(newId: DataSourceId): UnusableDataSource = copy(id = newId)

  def withoutCredentials: UnusableDataSource = this
}

object UnusableDataSource {
  implicit def unusableDataSourceFormat: Format[UnusableDataSource] =
    Json.format[UnusableDataSource]
}
