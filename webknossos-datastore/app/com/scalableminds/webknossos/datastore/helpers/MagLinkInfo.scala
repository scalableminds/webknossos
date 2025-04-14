package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.libs.json.{Format, Json}

case class DataSourceMagInfo(dataSourceId: DataSourceId,
                             dataLayerName: String,
                             mag: Vec3Int,
                             path: Option[String],
                             realPath: Option[String],
                             hasLocalData: Boolean)

object DataSourceMagInfo {
  implicit val jsonFormat: Format[DataSourceMagInfo] = Json.format[DataSourceMagInfo]
}

case class MagLinkInfo(mag: DataSourceMagInfo, linkedMags: Seq[DataSourceMagInfo])

object MagLinkInfo {
  implicit val jsonFormat: Format[MagLinkInfo] = Json.format[MagLinkInfo]
}

case class LayerMagLinkInfo(layerName: String, magLinkInfos: Seq[MagLinkInfo])

object LayerMagLinkInfo {
  implicit val jsonFormat: Format[LayerMagLinkInfo] = Json.format[LayerMagLinkInfo]
}
