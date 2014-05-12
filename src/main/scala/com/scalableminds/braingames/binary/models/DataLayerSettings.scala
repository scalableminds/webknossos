/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json.Json
import java.io.File
import scalax.file.Path

case class DataLayerSettings(
  typ: String,
  `class`: String,
  flags: Option[List[String]],
  fallback: Option[FallbackLayer])

object DataLayerSettings extends SettingsFile[DataLayerSettings] {
  val settingsFileReads = Json.reads[DataLayerSettings]

  val settingsFileName =  "layer.json"
}
