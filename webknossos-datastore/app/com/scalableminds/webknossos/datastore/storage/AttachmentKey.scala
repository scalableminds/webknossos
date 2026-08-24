package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, LayerAttachment}

trait AttachmentKey {
  val dataSourceId: DataSourceId
  val layerName: String
  val attachment: LayerAttachment
}
