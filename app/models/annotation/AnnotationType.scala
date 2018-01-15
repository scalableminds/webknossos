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
  val View = "View"
  val Explorational = "Explorational"
  val CompoundTask = "CompoundTask"
  val CompoundProject = "CompoundProject"
  val CompoundTaskType = "CompoundTaskType"

  val UserTracings = List(
    Task,
    Explorational,
    CompoundTask,
    CompoundProject,
    CompoundTaskType,
    View)

  // System types
  val TracingBase = "Tracing Base"
  val Orphan = "Orphan"  // Annotations, where the task was deleted

  val SystemTracings = List(
    TracingBase,
    Orphan)

  def isExploratory(t: Annotation): Boolean = t.typ == Explorational

  def isSystemTracing(t: Annotation) =
    SystemTracings.contains(t.typ)

  def isUserTracing(t: Annotation) =
    UserTracings.contains(t.typ)
}
