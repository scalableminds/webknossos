package models.tracing

object TracingType extends Enumeration {
  val Task = Value("Task")
  val Training = Value("Training")
  val Sample = Value("Trainings Sample")
  val Explorational = Value("Explorational")
  val Review = Value("Trainings Review")
}