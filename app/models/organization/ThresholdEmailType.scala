package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

/* Emails that are sent once when an organization crosses a threshold, e.g. a storage usage percentage or the
   number of days before its plan expires. Which thresholds were already announced is recorded per type. */
object ThresholdEmailType extends ExtendedEnumeration {
  type ThresholdEmailType = Value
  val PlanExpiry, StorageWarning = Value
}
