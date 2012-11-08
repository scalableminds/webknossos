package models.task

case class ExperimentState(
  isAssigned: Boolean = false,
  isFinished: Boolean = false,
  isInReview: Boolean = false,
  isInProgress: Boolean = false)

object ExperimentState{
  val Assigned = ExperimentState(isAssigned = true)
  val Unassigned = ExperimentState()

  val InReview = Assigned.copy(isInReview = true)

  val InProgress = Assigned.copy(isInProgress = true)

  val Finished = Assigned.copy(isFinished = true)
}