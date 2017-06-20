/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.json

import play.api.data.validation.ValidationError
import play.api.libs.json.Reads._
import play.api.libs.json._

trait GeoJSON

case class GeoPoint(lng: Double, lat: Double) extends GeoJSON

object GeoPoint {
  def equalReads[T](v: T)(implicit r: Reads[T]): Reads[T] =
    Reads.filter(ValidationError("validate.error.expected.value", v))(_ == v)

  implicit val geoPointWrites: Writes[GeoPoint] = Writes[GeoPoint]( p => Json.toJson(List(p.lng, p.lat)))

  implicit val geoPointReads: Reads[GeoPoint] = minLength[List[Double]](2).map(l => GeoPoint(l(0), l(1)))

  implicit val geoPointFormat = Format(geoPointReads, geoPointWrites)

  def random = {
    GeoPoint(math.random * 360 - 180, math.random * 180 - 90)
  }
}
