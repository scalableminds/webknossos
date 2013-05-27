package models.annotation

case class AnnotationState(
  isAssigned: Boolean = false,
  isFinished: Boolean = false,
  isInReview: Boolean = false,
  isReadyForReview: Boolean = false,
  isInProgress: Boolean = false)

object AnnotationState{
  val Assigned = AnnotationState(isAssigned = true)
  val Unassigned = AnnotationState()

  val ReadyForReview = Assigned.copy(isReadyForReview = true)
  
  val InReview = Assigned.copy(isInReview = true)

  val InProgress = Assigned.copy(isInProgress = true)

  val Finished = Assigned.copy(isFinished = true)
}