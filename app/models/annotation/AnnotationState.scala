package models.annotation

import play.api.libs.json.{Json, Reads, Writes}
import utils.EnumUtils

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

object AnnotationState2 extends Enumeration {
  type AnnotationStateValue = Value

  /*
    InProgress and Finished imply Assigned
   */
  val Unassigned = Value("UNASSIGNED")
  val Assigned = Value("ASSIGNED")
  val InProgress = Value("PROGRESS")
  val Finished = Value("FINISHED")

  val assignedStates = List (Assigned, InProgress, Finished)
  val assignedButNotFinished = List(Assigned, InProgress)

  implicit val enumReads: Reads[AnnotationStateValue] = EnumUtils.enumReads(AnnotationState2)

  implicit def enumWrites: Writes[AnnotationStateValue] = EnumUtils.enumWrites
}
