package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration

object AnnotationState extends ExtendedEnumeration {
  type AnnotationState = Value

  val Cancelled, Active, Finished, Initializing = Value
}
