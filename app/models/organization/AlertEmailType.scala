package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

/* Emails that alert an organization once it crosses a threshold, e.g. a storage usage percentage or the
   number of days before its plan expires. Which thresholds were already alerted about is recorded per type
   in organization_alertEmails. */
object AlertEmailType extends ExtendedEnumeration {
  type AlertEmailType = Value
  val PlanExpiry, StorageWarning = Value
}
