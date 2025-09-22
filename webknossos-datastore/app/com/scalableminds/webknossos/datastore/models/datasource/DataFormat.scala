package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.enumeration.ExtendedEnumeration

object DataFormat extends ExtendedEnumeration {
  val wkw, zarr, zarr3, n5, neuroglancerPrecomputed, tracing = Value
}
