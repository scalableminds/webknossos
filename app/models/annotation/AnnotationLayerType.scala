package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration

object AnnotationLayerType extends ExtendedEnumeration {
  type AnnotationLayerType = Value
  val Skeleton, Volume = Value
}
