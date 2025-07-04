package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.enumeration.ExtendedEnumeration

object SynapticPartnerDirection extends ExtendedEnumeration {
  type SynapticPartnerDirection = Value

  val src, dst = Value
}
