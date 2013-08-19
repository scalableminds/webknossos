package models.annotation

object AnnotationType {
  type AnnotationType = String

  // user types
  val Task = "Task"
  val Explorational = "Explorational"
  val Review = "Trainings Review"
  val CompoundTask = "CompoundTask"
  val CompoundProject = "CompoundProject"
  val CompoundTaskType = "CompoundTaskType"

  val UserTracings = List(Task, Explorational, Review)

  // system types
  val Sample = "Trainings Sample"
  val TracingBase = "Tracing Base"

  val SystemTracings = List(Sample, TracingBase)

  // tracings where the task got deleted
  val Orphan = "Orphan"

  def isExploratory(t: Annotation): Boolean = t.typ == Explorational

  def isSystemTracing(t: Annotation) =
    SystemTracings.contains(t.typ)
}