package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

object CreditState extends ExtendedEnumeration {
  type CreditState = Value
  val Pending, Spent, Refunded, Revoked, PartiallyRevoked, Refunding, Revoking, ChargedUp = Value
}
