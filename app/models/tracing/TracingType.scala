package models.tracing

object TracingType extends Enumeration {
  // user types
  val Task = Value("Task")
  val Explorational = Value("Explorational")
  val Review = Value("Trainings Review")
  val Temporary = Value("Temporary")
  
  val UserTracings = List(Task, Explorational, Review)

  // system types
  val Sample = Value("Trainings Sample")
  val TracingBase = Value("Tracing Base")
  
  val SystemTracings = List(Sample, TracingBase)
  
  // tracings where the task got deleted
  val Orphan = Value("Orphan")

  def isExploratory(t: Tracing) = t.tracingType == Explorational
  
  def isSystemTracing(t: Tracing) = 
    SystemTracings.contains(t.tracingType)
}