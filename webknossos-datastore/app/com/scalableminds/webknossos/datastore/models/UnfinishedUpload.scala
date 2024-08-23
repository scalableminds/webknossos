package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.libs.json.{Format, Json}

case class UnfinishedUpload(uploadId: String,
                            dataSourceId: DataSourceId,
                            folderId: String,
                            created: Instant,
                            filePaths: Option[List[String]],
                            allowedTeams: List[String])

object UnfinishedUpload {
  implicit val dataSourceIdFormat: Format[UnfinishedUpload] = Json.format[UnfinishedUpload]
}
