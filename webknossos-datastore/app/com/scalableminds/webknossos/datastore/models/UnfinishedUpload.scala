package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.time.Instant
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import play.api.libs.json.{Format, Json}

case class UnfinishedUpload(uploadId: String,
                            dataSourceId: DataSourceId,
                            datasetName: String,
                            folderId: String,
                            created: Instant,
                            filePaths: Option[List[String]],
                            allowedTeams: List[String]) {
  def withoutDataSourceId: UnfinishedUploadWithoutDataSourceId =
    UnfinishedUploadWithoutDataSourceId(uploadId, datasetName, folderId, created, filePaths, allowedTeams)
}

object UnfinishedUpload {
  implicit val dataSourceIdFormat: Format[UnfinishedUpload] = Json.format[UnfinishedUpload]
}

case class UnfinishedUploadWithoutDataSourceId(uploadId: String,
                                               datasetName: String,
                                               folderId: String,
                                               created: Instant,
                                               filePaths: Option[List[String]],
                                               allowedTeams: List[String])

object UnfinishedUploadWithoutDataSourceId {
  implicit val dataSourceIdFormat: Format[UnfinishedUploadWithoutDataSourceId] =
    Json.format[UnfinishedUploadWithoutDataSourceId]
}
