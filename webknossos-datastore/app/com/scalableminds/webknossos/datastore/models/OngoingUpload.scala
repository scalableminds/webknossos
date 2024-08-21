package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.libs.json.{Format, Json}

case class OngoingUpload(uploadId: String,
                         dataSourceId: DataSourceId,
                         folderId: String,
                         created: Instant,
                         allowedTeams: List[String])

object OngoingUpload {
  implicit val dataSourceIdFormat: Format[OngoingUpload] = Json.format[OngoingUpload]
}
