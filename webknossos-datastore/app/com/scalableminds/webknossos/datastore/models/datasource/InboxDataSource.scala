package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import play.api.libs.json.{Format, JsResult, JsValue, Json}

package object inbox {

  trait GenericInboxDataSource[+T <: DataLayerLike] {

    def id: DataSourceId

    def toUsable: Option[GenericDataSource[T]]

    def isUsable: Boolean = toUsable.isDefined

    def scaleOpt: Option[Vec3Double]

    def statusOpt: Option[String]

    def defaultViewConfiguration: Option[DatasetViewConfiguration]
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
                                                     scale: Option[Vec3Double] = None,
                                                     existingDataSourceProperties: Option[JsValue] = None)
      extends GenericInboxDataSource[T] {
    val toUsable: Option[GenericDataSource[T]] = None

    val scaleOpt: Option[Vec3Double] = scale

    val statusOpt: Option[String] = Some(status)

    val defaultViewConfiguration: Option[DatasetViewConfiguration] = None
  }

  object UnusableDataSource {
    implicit def unusableDataSourceFormat[T <: DataLayerLike]: Format[UnusableDataSource[T]] =
      Json.format[UnusableDataSource[T]]
  }

  type InboxDataSource = GenericInboxDataSource[DataLayer]
  type InboxDataSourceLike = GenericInboxDataSource[DataLayerLike]
  type UnusableInboxDataSource = UnusableDataSource[DataLayer]
}
