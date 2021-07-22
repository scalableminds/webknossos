package models.job

import com.scalableminds.util.enumeration.ExtendedEnumeration

object JobManualState extends ExtendedEnumeration {
  type JobManualState = Value
  val SUCCESS, FAILURE = Value
}
