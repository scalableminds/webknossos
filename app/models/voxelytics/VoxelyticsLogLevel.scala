package models.voxelytics

import com.scalableminds.util.enumeration.ExtendedEnumeration

object VoxelyticsLogLevel extends ExtendedEnumeration {
  type VoxelyticsLogLevel = Value
  val NOTSET, DEBUG, INFO, NOTICE, WARNING, ERROR, CRITICAL = Value
  val sortedValues: List[Value] = values.toList.sortBy(_.id)
}
