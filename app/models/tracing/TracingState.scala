package models.tracing

case class TracingState(
  isAssigned: Boolean = false,
  isFinished: Boolean = false,
  isInReview: Boolean = false,
  isReadyForReview: Boolean = false,
  isInProgress: Boolean = false)

object TracingState{
  val Assigned = TracingState(isAssigned = true)
  val Unassigned = TracingState()

  val ReadyForReview = Assigned.copy(isReadyForReview = true)
  
  val InReview = Assigned.copy(isInReview = true)

  val InProgress = Assigned.copy(isInProgress = true)

  val Finished = Assigned.copy(isFinished = true)
}