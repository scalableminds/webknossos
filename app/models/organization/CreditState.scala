package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

// See schema.sql for details.
object CreditState extends ExtendedEnumeration {
  type CreditState = Value
  val Pending, Spent, Refunded, Revoked, PartiallyRevoked, Refunding, Revoking, AddCredits = Value
}
