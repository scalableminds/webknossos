package models.annotation

import play.api.libs.json.Json

case class AnnotationState(
  isAssigned: Boolean = false,
  isFinished: Boolean = false,
  isInProgress: Boolean = false)

object AnnotationState{

  implicit val annotationStateFormat = Json.format[AnnotationState]

  val Assigned = AnnotationState(isAssigned = true)

  val Unassigned = AnnotationState()

  val InProgress = Assigned.copy(isInProgress = true)

  val Finished = Assigned.copy(isFinished = true)
}
