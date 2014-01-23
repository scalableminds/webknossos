package models.annotation

object AnnotationType {
  type AnnotationType = String

  // User types
  val Task = "Task"
  val View = "View"
  val Training = "Training"
  val Explorational = "Explorational"
  val Review = "Trainings Review"
  val CompoundTask = "CompoundTask"
  val CompoundProject = "CompoundProject"
  val CompoundTaskType = "CompoundTaskType"

  val UserTracings = List(
    Task,
    Explorational,
    Review,
    Training,
    CompoundTask,
    CompoundProject,
    CompoundTaskType,
    View)

  // System types
  val Sample = "Trainings Sample"
  val TracingBase = "Tracing Base"
  val Orphan = "Orphan"  // Annotations, where the task got deleted

  val SystemTracings = List(
    Sample,
    TracingBase,
    Orphan)


  def isExploratory(t: Annotation): Boolean = t.typ == Explorational

  def isSystemTracing(t: Annotation) =
    SystemTracings.contains(t.typ)

  def isUserTracing(t: Annotation) =
    UserTracings.contains(t.typ)
}