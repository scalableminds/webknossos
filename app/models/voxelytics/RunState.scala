package models.voxelytics

import com.scalableminds.util.enumeration.ExtendedEnumeration

object RunState extends ExtendedEnumeration {
  type RunState = Value
  val SKIPPED, PENDING, RUNNING, COMPLETE, FAILED, CANCELLED, STALE = Value
}
