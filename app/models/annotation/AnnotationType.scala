package models.annotation

object AnnotationType {
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

  def isExploratory(t: Tracing) = t.tracingType == Explorational
  
  def isSystemTracing(t: Tracing) = 
    SystemTracings.contains(t.tracingType)
}