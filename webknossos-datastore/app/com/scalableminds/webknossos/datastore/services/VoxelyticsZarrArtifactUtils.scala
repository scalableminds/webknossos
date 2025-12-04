package com.scalableminds.webknossos.datastore.services

import play.api.libs.json.{JsLookupResult, JsResult, JsValue}

trait VoxelyticsZarrArtifactUtils {

  val FILENAME_ZARR_JSON = "zarr.json"

  private val keyAttributes = "attributes"
  private val keyVx = "voxelytics"
  private val keyFormatVersion = "artifact_schema_version"
  private val keyArtifactAttrs = "artifact_attributes"

  protected def readArtifactSchemaVersion(zarrGroupJson: JsValue): JsResult[Long] =
    (zarrGroupJson \ keyAttributes \ keyVx \ keyFormatVersion).validate[Long]

  protected def lookUpArtifactAttributes(zarrGroupJson: JsValue): JsLookupResult =
    zarrGroupJson \ keyAttributes \ keyVx \ keyArtifactAttrs

}
