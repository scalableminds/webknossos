package com.scalableminds.webknossos.datastore.models

import com.scalableminds.webknossos.datastore.models.datasource.inbox.GenericInboxDataSource
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import play.api.libs.json._

package object datasource {

  case class DataSourceId(name: String, team: String) // here team is not (yet) renamed to organization to avoid migrating all jsons

  object DataSourceId {
    implicit val dataSourceIdFormat: Format[DataSourceId] = Json.format[DataSourceId]
  }

  case class ViewConfiguration(position: Option[Point3D], zoom: Option[Point3D], interpolation: Option[Boolean]) {

    def toMap: Map[String, JsValue] = {
      def getSeqFromNameAndValue[T](name: String, value: Option[T])(implicit fmt: Format[T]) =
        value.map(v => Seq(name -> Json.toJson(v))).getOrElse(Nil)

      val positionSeq = getSeqFromNameAndValue("position", position)
      val zoomSeq = getSeqFromNameAndValue("zoom", zoom)
      val interpolationSeq = getSeqFromNameAndValue("interpolation", interpolation)
      (positionSeq ++ zoomSeq ++ interpolationSeq).toMap
    }
  }

  object ViewConfiguration {
    implicit val viewConfigurationFormat: Format[ViewConfiguration] = Json.format[ViewConfiguration]
  }

  case class GenericDataSource[+T <: DataLayerLike](id: DataSourceId,
                                                    dataLayers: List[T],
                                                    scale: Scale,
                                                    defaultViewConfiguration: Option[ViewConfiguration] = None)
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
      Json.format[GenericDataSource[T]]
  }

  type DataSource = GenericDataSource[DataLayer]
  type DataSourceLike = GenericDataSource[DataLayerLike]
}
