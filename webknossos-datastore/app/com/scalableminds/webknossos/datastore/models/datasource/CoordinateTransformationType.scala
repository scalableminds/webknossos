package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.enumeration.ExtendedEnumeration

object CoordinateTransformationType extends ExtendedEnumeration {
  type CoordinateTransformationType = Value
  val affine: CoordinateTransformationType = Value

}
