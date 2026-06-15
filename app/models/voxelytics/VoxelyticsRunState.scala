package models.voxelytics

import com.scalableminds.util.enumeration.ExtendedEnumeration

object VoxelyticsRunState extends ExtendedEnumeration {
  type VoxelyticsRunState = Value
  val SKIPPED, PENDING, RUNNING, COMPLETE, FAILED, CANCELLED, STALE = Value

  def nonWaitingStates: List[Value] = List(RUNNING, COMPLETE, FAILED, CANCELLED, STALE)
}
