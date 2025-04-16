package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import play.api.libs.json.{Format, JsResult, JsValue, Json}

package object inbox {

  trait GenericInboxDataSource[+T <: DataLayerLike] {

    def id: DataSourceId
    def withUpdatedId(newId: DataSourceId): GenericInboxDataSource[T]

    def toUsable: Option[GenericDataSource[T]]

    def isUsable: Boolean = toUsable.isDefined

    def voxelSizeOpt: Option[VoxelSize]

    def statusOpt: Option[String]

    def defaultViewConfiguration: Option[DatasetViewConfiguration]

    def specialFiles: List[SpecialFile]
  }

  object GenericInboxDataSource {
    implicit def inboxDataSourceFormat[T <: DataLayerLike](implicit fmt: Format[T]): Format[GenericInboxDataSource[T]] =
      new Format[GenericInboxDataSource[T]] {
        def reads(json: JsValue): JsResult[GenericInboxDataSource[T]] =
          GenericDataSource.dataSourceFormat.reads(json).orElse(UnusableDataSource.unusableDataSourceFormat.reads(json))

        def writes(ds: GenericInboxDataSource[T]): JsValue =
          ds match {
            case ds: GenericDataSource[T]  => GenericDataSource.dataSourceFormat.writes(ds)
            case ds: UnusableDataSource[T] => UnusableDataSource.unusableDataSourceFormat.writes(ds)
          }
      }
  }

  case class UnusableDataSource[+T <: DataLayerLike](id: DataSourceId,
                                                     status: String,
                                                     scale: Option[VoxelSize] = None,
                                                     existingDataSourceProperties: Option[JsValue] = None)
      extends GenericInboxDataSource[T] {
    val toUsable: Option[GenericDataSource[T]] = None

    val voxelSizeOpt: Option[VoxelSize] = scale

    val statusOpt: Option[String] = Some(status)

    val defaultViewConfiguration: Option[DatasetViewConfiguration] = None

    val specialFiles: List[SpecialFile] = Nil

    def withUpdatedId(newId: DataSourceId): UnusableDataSource[T] = copy(id = newId)
  }

  object UnusableDataSource {
    implicit def unusableDataSourceFormat[T <: DataLayerLike]: Format[UnusableDataSource[T]] =
      Json.format[UnusableDataSource[T]]
  }

  type InboxDataSource = GenericInboxDataSource[DataLayer]
  type InboxDataSourceLike = GenericInboxDataSource[DataLayerLike]
  type UnusableInboxDataSource = UnusableDataSource[DataLayer]
}
