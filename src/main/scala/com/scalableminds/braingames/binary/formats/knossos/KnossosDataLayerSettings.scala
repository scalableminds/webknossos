/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.knossos

import com.scalableminds.braingames.binary.models.{FallbackLayer, SettingsFile}
import play.api.libs.json.Json

case class KnossosDataLayerSettings(
                              typ: String,
                              `class`: String,
                              largestValue: Option[Long],
                              flags: Option[List[String]],
                              isCompressed: Option[Boolean],
                              fallback: Option[FallbackLayer])

object KnossosDataLayerSettings extends SettingsFile[KnossosDataLayerSettings] {
  val settingsFileReads = Json.reads[KnossosDataLayerSettings]

  val settingsFileName = "layer.json"
}
