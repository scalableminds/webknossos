package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import play.api.libs.json.{JsValue, Json}

case class NDBoundingBox(boundingBox: BoundingBox, additionalAxes: Seq[AdditionalAxis], fullAxisOrder: FullAxisOrder) {

  def toWkLibsDict: JsValue = {
    val additionalAxesDict = Json.toJson(additionalAxes)
    val axisOrderDict = fullAxisOrder.toWkLibsJson
    boundingBox.toWkLibsJson ++ Json.obj("additionalAxes" -> additionalAxesDict, "axisOrder" -> axisOrderDict)
  }

}
