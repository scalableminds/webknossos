package com.scalableminds.webknossos.datastore.models

import com.scalableminds.webknossos.datastore.models.datasource.inbox.GenericInboxDataSource
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import play.api.libs.json._

package object datasource {

  case class DataSourceId(name: String, team: String) // here team is not (yet) renamed to organization to avoid migrating all jsons

  object DataSourceId {
    implicit val dataSourceIdFormat: Format[DataSourceId] = Json.format[DataSourceId]
  }

  case class GenericDataSource[+T <: DataLayerLike](id: DataSourceId, dataLayers: List[T], scale: Scale)
      extends GenericInboxDataSource[T] {

    val toUsable: Option[GenericDataSource[T]] = Some(this)

    val scaleOpt: Option[Scale] = Some(scale)

    val statusOpt: Option[String] = None

    def getDataLayer(name: String): Option[T] =
      dataLayers.find(_.name == name)

    val center: Point3D = boundingBox.center

    lazy val boundingBox: BoundingBox =
      BoundingBox.combine(dataLayers.map(_.boundingBox))
  }

  object GenericDataSource {

    implicit def dataSourceFormat[T <: DataLayerLike](implicit fmt: Format[T]): Format[GenericDataSource[T]] =
      new Format[GenericDataSource[T]] {

        def reads(json: JsValue): JsResult[GenericDataSource[T]] =
          for {
            id <- (json \ "id").validate[DataSourceId]
            dataLayers <- (json \ "dataLayers").validate[List[T]]
            scale <- (json \ "scale").validate[Scale]
          } yield {
            GenericDataSource(id, dataLayers, scale)
          }

        def writes(ds: GenericDataSource[T]) = Json.obj(
          "id" -> DataSourceId.dataSourceIdFormat.writes(ds.id),
          "dataLayers" -> ds.dataLayers.map(Json.toJson(_)),
          "scale" -> Scale.scaleWrites.writes(ds.scale)
        )
      }
  }

  type DataSource = GenericDataSource[DataLayer]
  type DataSourceLike = GenericDataSource[DataLayerLike]
}
