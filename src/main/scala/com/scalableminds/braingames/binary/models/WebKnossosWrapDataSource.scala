/*
 * Copyright (C) 2011-2017 scalableminds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.nio.file.Path

import play.api.i18n.Messages
import play.api.libs.json.Json
import com.scalableminds.util.geometry.Scale

case class WebKnossosWrapDataSourceSettings(
                                           scale: Scale,
                                           priority: Option[Int],
                                           layers: List[WebKnossosWrapDataLayerSettings])

object WebKnossosWrapDataSourceSettings extends SettingsFile[WebKnossosWrapDataSourceSettings] {
  val settingsFileReads = Json.reads[WebKnossosWrapDataSourceSettings]
  val settingsFileName = "settings.json"
}

class WebKnossosWrapDataSource(basePath: Path)(implicit messages: Messages) {
  val settings = WebKnossosWrapDataSourceSettings.fromSettingsFileIn(basePath, basePath)

  def getLayer(layerName: String) = {
    for {
      s <- settings
      layer <- s.layers.find(_.name == layerName)
    } yield {
      new WebKnossosWrapDataLayer(layer)
    }
  }
}
