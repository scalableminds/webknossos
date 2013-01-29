package models.tracing

object TracingType extends Enumeration {
  val Task = Value("Task")
  val TracingBase = Value("Tracing Base")
  val Sample = Value("Trainings Sample")
  val Explorational = Value("Explorational")
  val Orphan = Value("Orphan")
  val Review = Value("Trainings Review")
  
  def isExploratory(t: Tracing) = t.tracingType == Explorational
  
  def isSystemTracing(t: Tracing) = 
    t.tracingType == TracingBase || t.tracingType == Sample
}