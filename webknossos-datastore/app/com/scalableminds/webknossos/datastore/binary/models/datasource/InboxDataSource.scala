/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.binary.models.datasource

import play.api.libs.json.{Format, JsResult, JsValue, Json}

package object inbox {

  trait GenericInboxDataSource[+T <: DataLayerLike] {

    def id: DataSourceId

    def toUsable: Option[GenericDataSource[T]]

    def isUsable: Boolean = toUsable.isDefined
  }

  object GenericInboxDataSource {

    implicit def inboxDataSourceFormat[T <: DataLayerLike](implicit fmt: Format[T]): Format[GenericInboxDataSource[T]] = new Format[GenericInboxDataSource[T]] {
      def reads(json: JsValue): JsResult[GenericInboxDataSource[T]] = {
        GenericDataSource.dataSourceFormat.reads(json)
          .orElse(UnusableDataSource.unusableDataSourceFormat.reads(json))
      }

      def writes(ds: GenericInboxDataSource[T]): JsValue = {
        ds match {
          case ds: GenericDataSource[T] => GenericDataSource.dataSourceFormat.writes(ds)
          case ds: UnusableDataSource[T] => UnusableDataSource.unusableDataSourceFormat.writes(ds)
        }
      }
    }
  }

  case class UnusableDataSource[+T <: DataLayerLike](id: DataSourceId, status: String) extends GenericInboxDataSource[T] {
    val toUsable: Option[GenericDataSource[T]] = None
  }

  object UnusableDataSource {

    implicit def unusableDataSourceFormat[T <: DataLayerLike](implicit fmt: Format[T]): Format[UnusableDataSource[T]] = new Format[UnusableDataSource[T]] {
      def reads(json: JsValue): JsResult[UnusableDataSource[T]] = {
        for {
          id <- (json \ "id").validate[DataSourceId]
          status <- (json \ "status").validate[String]
        } yield UnusableDataSource(id, status)
      }

      def writes(ds: UnusableDataSource[T]): JsValue = {
        Json.obj(
          "id" -> Json.toJson(ds.id),
          "status" -> ds.status
        )
      }
    }
  }

  type InboxDataSource = GenericInboxDataSource[DataLayer]
  type InboxDataSourceLike = GenericInboxDataSource[DataLayerLike]
}
