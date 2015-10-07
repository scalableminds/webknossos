/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json.Json

case class DataSourceUpload(
  name: String,
  team: String,
  mimeType: String,
  content: String
  )

object DataSourceUpload {
  implicit val dataSourceUploadFormat = Json.format[DataSourceUpload]
}
