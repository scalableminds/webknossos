package models.task

object ExperimentType extends Enumeration {
  val Task = Value("Task")
  val Training = Value("Training")
  val Sample = Value("Sample")
  val Explorational = Value("Explorational")
  val Review = Value("Review")
}