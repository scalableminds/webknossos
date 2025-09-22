package com.scalableminds.webknossos.datastore.models.datasource

import play.api.libs.json.{Format, JsResult, JsValue, Json}

case class DataSourceId(directoryName: String, organizationId: String) {
  override def toString: String = s"$organizationId/$directoryName"
}

object DataSourceId {
  // The legacy names for the directory name and organization id are "name" and "team".
  // We keep the old names in serialization and deserialization for backwards compatibility.
  implicit object DataSourceIdFormat extends Format[DataSourceId] {
    override def reads(json: JsValue): JsResult[DataSourceId] =
      (json \ "name").validate[String] flatMap { nameRenamedToPath =>
        (json \ "team").validate[String].map { teamRenamedToOrganization =>
          DataSourceId(nameRenamedToPath, teamRenamedToOrganization)
        }
      }

    override def writes(datasetId: DataSourceId): JsValue =
      Json.obj(
        "name" -> datasetId.directoryName,
        "team" -> datasetId.organizationId,
      )
  }
}
