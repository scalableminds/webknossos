/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json.Json

case class DataLayerSettings(
                              typ: String,
                              `class`: String,
                              largestValue: Option[Long],
                              flags: Option[List[String]],
                              isCompressed: Option[Boolean],
                              fallback: Option[FallbackLayer])

object DataLayerSettings extends SettingsFile[DataLayerSettings] {
  val settingsFileReads = Json.reads[DataLayerSettings]

  val settingsFileName = "layer.json"
}
