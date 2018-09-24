package models.annotation

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object AnnotationType extends Enumeration {
  type AnnotationType = Value

  val Task, View, Explorational, TracingBase, Orphan, CompoundTask, CompoundProject, CompoundTaskType = Value

  implicit val enumReads: Reads[AnnotationType.Value] = EnumUtils.enumReads(AnnotationType)

  implicit def enumWrites: Writes[AnnotationType.Value] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)

  def UserTracings = List(Task, Explorational)
}
