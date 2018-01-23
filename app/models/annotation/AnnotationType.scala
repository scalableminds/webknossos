package models.annotation

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object AnnotationTypeSQL extends Enumeration {
  val Task, View, Explorational, TracingBase, Orphan, CompoundTask, CompoundProject, CompoundTaskType = Value

  implicit val enumReads: Reads[AnnotationTypeSQL.Value] = EnumUtils.enumReads(AnnotationTypeSQL)

  implicit def enumWrites: Writes[AnnotationTypeSQL.Value] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}


object AnnotationType {
  type AnnotationType = String

  // User types
  val Task = "Task"
  val Explorational = "Explorational"

  // View is an artifact of the frontend using the same code for tracing and dataset viewing. never found in db
  val View = "View"

  // Compound types. never found in db
  val CompoundTask = "CompoundTask"
  val CompoundProject = "CompoundProject"
  val CompoundTaskType = "CompoundTaskType"

  // System Types
  val TracingBase = "Tracing Base"
  val Orphan = "Orphan"  // Annotations whose task was deleted

  val UserTracings = List(
    Task,
    Explorational)

  val SystemTracings = List(
    TracingBase,
    Orphan)
}
