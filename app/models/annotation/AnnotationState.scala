package models.annotation

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object AnnotationState extends Enumeration {
  type AnnotationState = Value

  val Cancelled: AnnotationState = Value("Cancelled")
  val Active: AnnotationState = Value("Active")
  val Finished: AnnotationState = Value("Finished")
  val Initializing: AnnotationState = Value("Initializing")

  implicit val enumReads: Reads[AnnotationState] = EnumUtils.enumReads(AnnotationState)

  implicit def enumWrites: Writes[AnnotationState] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}
