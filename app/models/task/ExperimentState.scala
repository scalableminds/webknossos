package models.task

trait ExperimentState {
  def isAssigned = false
  def isFinished = false
  def isInReview = false
  def isInProgress = false
}

trait Assigned extends ExperimentState  {
  override def isAssigned = true
}

object Unassigned extends ExperimentState

object InReview extends ExperimentState with Assigned {
  override def isFinished = false
  override def isInReview = true
}

object InProgress extends ExperimentState with Assigned {
  override def isInProgress = true
}

object Finished extends ExperimentState with Assigned {
  override def isFinished = true
}