package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.AutoJsonFormat
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId

case class DataSourceMagInfo(
    dataSourceId: DataSourceId,
    dataLayerName: String,
    mag: Vec3Int,
    path: Option[String],
    realPath: Option[String],
    hasLocalData: Boolean
) derives AutoJsonFormat

case class MagLinkInfo(mag: DataSourceMagInfo, linkedMags: Seq[DataSourceMagInfo]) derives AutoJsonFormat

case class LayerMagLinkInfo(layerName: String, magLinkInfos: Seq[MagLinkInfo]) derives AutoJsonFormat
