package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

object CreditTransactionState extends ExtendedEnumeration {
  type TransactionState = Value
  val Pending, Complete = Value
}
