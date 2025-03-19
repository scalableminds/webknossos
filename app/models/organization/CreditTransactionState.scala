package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

// See schema.sql for details.
object CreditTransactionState extends ExtendedEnumeration {
  type TransactionState = Value
  val Pending, Complete = Value
}
