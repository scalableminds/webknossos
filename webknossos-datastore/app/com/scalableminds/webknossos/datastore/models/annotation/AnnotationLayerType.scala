package com.scalableminds.webknossos.datastore.models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.Annotation.AnnotationLayerTypeProto

object AnnotationLayerType extends ExtendedEnumeration {
  type AnnotationLayerType = Value
  val Skeleton, Volume = Value

  def toProto(annotationLayerType: AnnotationLayerType): AnnotationLayerTypeProto =
    annotationLayerType match {
      case Skeleton => AnnotationLayerTypeProto.Skeleton
      case Volume   => AnnotationLayerTypeProto.Volume
    }

  def fromProto(p: AnnotationLayerTypeProto): AnnotationLayerType =
    p match {
      case AnnotationLayerTypeProto.Skeleton => Skeleton
      case AnnotationLayerTypeProto.Volume   => Volume
      case AnnotationLayerTypeProto.Unrecognized(_) =>
        Volume // unrecognized should never happen, artifact of proto code generation
    }
}
