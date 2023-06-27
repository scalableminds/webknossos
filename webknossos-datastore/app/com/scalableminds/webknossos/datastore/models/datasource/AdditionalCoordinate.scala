package com.scalableminds.webknossos.datastore.models.datasource

import play.api.libs.json.{Format, Json}

case class AdditionalCoordinate(name: String, bounds: Array[Int], index: Int) {
  def lowerBound: Int = bounds(0)
  def upperBound: Int = bounds(1)
}

object AdditionalCoordinate {
  implicit val jsonFormat: Format[AdditionalCoordinate] = Json.format[AdditionalCoordinate]
}
