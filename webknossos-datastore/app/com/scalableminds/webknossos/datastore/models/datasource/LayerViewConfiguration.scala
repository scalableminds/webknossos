package com.scalableminds.webknossos.datastore.models.datasource

import play.api.libs.json.{Format, JsObject, JsValue, Reads, Writes}

object LayerViewConfiguration {
  type LayerViewConfiguration = Map[String, JsValue]

  def empty: LayerViewConfiguration = Map()

  implicit val jsonFormat: Format[LayerViewConfiguration] =
    Format(Reads.mapReads[JsValue], Writes(JsObject(_)))
}
