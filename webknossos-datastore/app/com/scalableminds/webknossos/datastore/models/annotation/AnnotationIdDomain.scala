package com.scalableminds.webknossos.datastore.models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration

object AnnotationIdDomain extends ExtendedEnumeration {
  type AnnotationIdDomain = Value
  val Segment, SegmentGroup, Tree, Node, TreeGroup, BoundingBox = Value
}
