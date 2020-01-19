package models.annotation

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object AnnotationVisibility extends Enumeration {
  type AnnotationVisibility = Value

  val Private, Internal, Public = Value

  implicit val enumReads: Reads[AnnotationVisibility.Value] = EnumUtils.enumReads(AnnotationVisibility)

  implicit def enumWrites: Writes[AnnotationVisibility.Value] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}
