package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

/* Emails that are sent once an organization crosses a threshold, e.g. a storage usage percentage or the
   number of days before its plan expires. The thresholds the organization was already notified about are
   recorded per type in organization_notifiedEmailThresholds. */
object EmailThresholdType extends ExtendedEnumeration {
  type EmailThresholdType = Value
  val PlanExpiry, StorageWarning = Value
}
