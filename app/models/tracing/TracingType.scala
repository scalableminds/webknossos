package models.tracing

object TracingType extends Enumeration {
  val Task = Value("Task")
  val Training = Value("Training")
  val Sample = Value("Trainings Sample")
  val Explorational = Value("Explorational")
  val Orphan = Value("Orphan")
  val Review = Value("Trainings Review")
  
  def isTrainingsTracing(t: Tracing) = t.tracingType == Training

  def isExploratory(t: Tracing) = t.tracingType == Explorational
}