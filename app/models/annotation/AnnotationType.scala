package models.annotation

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object AnnotationTypeSQL extends Enumeration {
  type AnnotationTypeSQL = Value

  val Task, View, Explorational, TracingBase, Orphan, CompoundTask, CompoundProject, CompoundTaskType = Value

  implicit val enumReads: Reads[AnnotationTypeSQL.Value] = EnumUtils.enumReads(AnnotationTypeSQL)

  implicit def enumWrites: Writes[AnnotationTypeSQL.Value] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)

  def UserTracings = List(Task, Explorational)
}
