package com.scalableminds.webknossos.datastore.models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.Annotation.AnnotationLayerTypeProto

object AnnotationLayerType extends ExtendedEnumeration {
  type AnnotationLayerType = Value
  val Skeleton, Volume = Value

  def toProto(annotationLayerType: AnnotationLayerType): AnnotationLayerTypeProto =
    annotationLayerType match {
      case Skeleton => AnnotationLayerTypeProto.skeleton
      case Volume   => AnnotationLayerTypeProto.volume
    }
}
