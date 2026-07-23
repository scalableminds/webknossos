package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.enumeration.ExtendedEnumeration

object MappingType extends ExtendedEnumeration {
  type MappingType = Value

  val JSON, AGGLOMERATE = Value
}
