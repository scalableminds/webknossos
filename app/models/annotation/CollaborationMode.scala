package models.annotation

import com.scalableminds.util.enumeration.ExtendedEnumeration

object CollaborationMode extends ExtendedEnumeration {
  type CollaborationMode = Value
  val OwnerOnly, Exclusive, Concurrent = Value
}
