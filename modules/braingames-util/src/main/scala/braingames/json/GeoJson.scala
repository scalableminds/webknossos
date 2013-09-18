package braingames.json

import play.api.libs.json._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.data.validation.ValidationError

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 17.09.13
 * Time: 17:43
 */
trait GeoJSON

case class GeoPoint(lng: Double, lat: Double) extends GeoJSON

object GeoPoint {
  def equalReads[T](v: T)(implicit r: Reads[T]): Reads[T] =
    Reads.filter(ValidationError("validate.error.expected.value", v))(_ == v)

  /*
  // Cant currently be used, because reactive doesn't support 2dsphere in 0.9, but it is in 0.10
  implicit val geoPointWrites: Writes[GeoPoint] = (
    (__ \ "type").write[String] and
      (__ \ "coordinates").write[List[Double]]
    )(g => ("Point", List(g.lng, g.lat)))

  implicit val geoPointReads: Reads[GeoPoint] = (
    (__ \ "type").read[String](equalReads("Point")) andKeep
      (__ \ "coordinates").read[List[Double]](minLength[List[Double]](2))
    ).map(l => GeoPoint(l(0), l(1)))

  implicit val geoPointFormat = Format(geoPointReads, geoPointWrites)

  */

  implicit val geoPointWrites: Writes[GeoPoint] = Writes[GeoPoint]( p => Json.toJson(List(p.lng, p.lat)))

  implicit val geoPointReads: Reads[GeoPoint] = minLength[List[Double]](2).map(l => GeoPoint(l(0), l(1)))

  implicit val geoPointFormat = Format(geoPointReads, geoPointWrites)

  def random = {
    GeoPoint(math.random * 360 - 180, math.random * 180 - 90)
  }
}