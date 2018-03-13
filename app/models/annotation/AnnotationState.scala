package models.annotation

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object AnnotationState extends Enumeration {
  type AnnotationState = Value

  val Cancelled = Value("Cancelled")
  val Active = Value("Active")
  val Finished = Value("Finished")

  implicit val enumReads: Reads[AnnotationState] = EnumUtils.enumReads(AnnotationState)

  implicit def enumWrites: Writes[AnnotationState] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}
