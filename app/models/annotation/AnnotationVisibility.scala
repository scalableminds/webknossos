package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration

object AnnotationVisibility extends ExtendedEnumeration {
  type AnnotationVisibility = Value

  val Private, Internal, Public = Value
}
