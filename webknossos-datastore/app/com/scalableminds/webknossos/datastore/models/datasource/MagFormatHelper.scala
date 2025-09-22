package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.geometry.Vec3Int
import play.api.libs.json.{Format, JsResult, JsValue}

trait MagFormatHelper {

  implicit object magFormat extends Format[Vec3Int] {

    override def reads(json: JsValue): JsResult[Vec3Int] =
      json.validate[Int].map(result => Vec3Int(result, result, result)).orElse(Vec3Int.Vec3IntReads.reads(json))

    override def writes(mag: Vec3Int): JsValue =
      Vec3Int.Vec3IntWrites.writes(mag)
  }

}
