package models.annotation

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object AnnotationState extends Enumeration {
  type AnnotationStateValue = Value

  val Cancelled = Value("Cancelled")
  val Active = Value("Active")
  val Finished = Value("Finished")

  implicit val enumReads: Reads[AnnotationStateValue] = EnumUtils.enumReads(AnnotationState)

  implicit def enumWrites: Writes[AnnotationStateValue] = EnumUtils.enumWrites
}
