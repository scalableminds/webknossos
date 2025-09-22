package com.scalableminds.webknossos.datastore.models.datasource

import play.api.libs.json.{Format, JsValue}

object LayerViewConfiguration {
  type LayerViewConfiguration = Map[String, JsValue]

  def empty: LayerViewConfiguration = Map()

  implicit val jsonFormat: Format[LayerViewConfiguration] = Format.of[LayerViewConfiguration]
}
