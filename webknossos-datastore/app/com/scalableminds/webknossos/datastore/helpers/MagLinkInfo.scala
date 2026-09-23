package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId

case class DataSourceMagInfo(
    dataSourceId: DataSourceId,
    dataLayerName: String,
    mag: Vec3Int,
    path: Option[String],
    realPath: Option[String],
    hasLocalData: Boolean
) derives JsonAutoFormat

case class MagLinkInfo(mag: DataSourceMagInfo, linkedMags: Seq[DataSourceMagInfo]) derives JsonAutoFormat

case class LayerMagLinkInfo(layerName: String, magLinkInfos: Seq[MagLinkInfo]) derives JsonAutoFormat
