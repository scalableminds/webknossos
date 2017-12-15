package models.annotation

import play.api.libs.json.{Json, Reads, Writes}
import utils.EnumUtils

object AnnotationState extends Enumeration {
  type AnnotationStateValue = Value

  /*
    InProgress and Finished imply Assigned
   */
  val Unassigned = Value("Unassigned")
  val Assigned = Value("Aassigned")
  val InProgress = Value("Progress")
  val Finished = Value("Finished")

  val assignedStates = List (Assigned, InProgress, Finished)
  val assignedButNotFinished = List(Assigned, InProgress)
  val assignedButNotInProgress = List(Assigned, Finished)

  implicit val enumReads: Reads[AnnotationStateValue] = EnumUtils.enumReads(AnnotationState)

  implicit def enumWrites: Writes[AnnotationStateValue] = EnumUtils.enumWrites
}
