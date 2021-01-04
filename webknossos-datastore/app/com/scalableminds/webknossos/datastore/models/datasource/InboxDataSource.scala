package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.Scale
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import play.api.libs.json.{Format, JsResult, JsValue, Json}

package object inbox {

  trait GenericInboxDataSource[+T <: DataLayerLike] {

    def id: DataSourceId

    def toUsable: Option[GenericDataSource[T]]

    def isUsable: Boolean = toUsable.isDefined

    def scaleOpt: Option[Scale]

    def statusOpt: Option[String]

    def defaultViewConfiguration: Option[DataSetViewConfiguration]
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

  case class UnusableDataSource[+T <: DataLayerLike](id: DataSourceId, status: String, scale: Option[Scale] = None)
      extends GenericInboxDataSource[T] {
    val toUsable: Option[GenericDataSource[T]] = None

    val scaleOpt: Option[Scale] = scale

    val statusOpt: Option[String] = Some(status)

    val defaultViewConfiguration: Option[DataSetViewConfiguration] = None
  }

  object UnusableDataSource {
    implicit def unusableDataSourceFormat[T <: DataLayerLike]: Format[UnusableDataSource[T]] =
      Json.format[UnusableDataSource[T]]
  }

  type InboxDataSource = GenericInboxDataSource[DataLayer]
  type InboxDataSourceLike = GenericInboxDataSource[DataLayerLike]
}
