package models.job

import com.scalableminds.util.enumeration.ExtendedEnumeration

object JobState extends ExtendedEnumeration {
  type JobState = Value
  val PENDING, STARTED, SUCCESS, FAILURE = Value
}
