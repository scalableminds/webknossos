package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId

case class UnfinishedUpload(
    uploadId: String, // Dummy value on wk-side, then filled in by datastore via redis
    dataSourceId: DataSourceId,
    datasetName: String,
    folderId: String,
    created: Instant,
    filePaths: Option[Seq[String]],
    allowedTeams: Seq[String]
) derives JsonAutoFormat {
  def withoutDataSourceId: UnfinishedUploadWithoutDataSourceId =
    UnfinishedUploadWithoutDataSourceId(uploadId, datasetName, folderId, created, filePaths, allowedTeams)
}

case class UnfinishedUploadWithoutDataSourceId(
    uploadId: String,
    datasetName: String,
    folderId: String,
    created: Instant,
    filePaths: Option[Seq[String]],
    allowedTeams: Seq[String]
) derives JsonAutoFormat
