package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration

object AnnotationType extends ExtendedEnumeration {
  type AnnotationType = Value
  val Task, View, Explorational, TracingBase, Orphan, CompoundTask, CompoundProject, CompoundTaskType = Value

  def UserTracings = List(Task, Explorational)
}
