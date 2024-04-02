package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.SkeletonTracing.TreeTypeProto

object TreeType extends ExtendedEnumeration {
  type TreeType = Value
  val DEFAULT, AGGLOMERATE = Value

  def toProto(treeType: TreeType): TreeTypeProto = treeType match {
    case DEFAULT     => TreeTypeProto.DEFAULT
    case AGGLOMERATE => TreeTypeProto.AGGLOMERATE
  }

  def fromProto(treeTypeProto: TreeTypeProto): TreeType = treeTypeProto match {
    case TreeTypeProto.DEFAULT     => DEFAULT
    case TreeTypeProto.AGGLOMERATE => AGGLOMERATE
    case _                         => DEFAULT // proto has “unrecognized” enum field
  }
}
