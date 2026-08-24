package com.scalableminds.webknossos.tracingstore.annotation

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.tracingstore.tracings.volume.BucketMutatingVolumeUpdateAction

import scala.collection.mutable
import scala.concurrent.ExecutionContext

class UpdateTimingStats {
  private val counters: mutable.LinkedHashMap[String, Long] = mutable.LinkedHashMap.empty
  private val phaseDurationsNanos: mutable.LinkedHashMap[String, Long] = mutable.LinkedHashMap.empty
  private var requestShapeSummary: String = "not recorded"

  def recordRequestShape(updateGroups: List[UpdateActionGroup]): Unit = {
    val actions = updateGroups.flatMap(_.actions)
    val actionTypeCounts = actions
      .groupBy(_.getClass.getSimpleName)
      .view
      .mapValues(_.length)
      .toSeq
      .sortBy { case (_, count) => -count }
      .map { case (name, count) => s"$name=$count" }
      .mkString(", ")
    val versions = updateGroups.map(_.version)
    val bucketMutatingActionCountsPerGroup: List[Int] = updateGroups.map(_.actions.count {
      case _: BucketMutatingVolumeUpdateAction => true
      case _                                   => false
    })
    val groupsWithBucketMutatingActions = bucketMutatingActionCountsPerGroup.count(_ > 0)
    requestShapeSummary = s"groups=${updateGroups.length}, " +
      s"transactions=${updateGroups.map(_.transactionId).distinct.length}, " +
      s"actions=${actions.length}, " +
      s"versions=${versions.minOption.getOrElse(0)}-${versions.maxOption.getOrElse(0)}, " +
      s"significantChanges=${updateGroups.map(_.significantChangesCount).sum}, " +
      s"viewChanges=${updateGroups.map(_.viewChangesCount).sum}, " +
      s"actionTypes=[$actionTypeCounts], " +
      s"groupsWithBucketMutatingActions=$groupsWithBucketMutatingActions/${updateGroups.length}, " +
      s"bucketMutatingActionsPerGroup=[${bucketMutatingActionCountsPerGroup.mkString(",")}]"
  }

  def count(key: String, by: Long = 1): Unit =
    counters.update(key, counters.getOrElse(key, 0L) + by)

  def time[T](phase: String)(fox: => Fox[T])(implicit ec: ExecutionContext): Fox[T] = {
    val start = System.nanoTime()
    val result = fox
    Fox.fromFutureBox(result.futureBox.andThen { case _ =>
      phaseDurationsNanos.update(phase, phaseDurationsNanos.getOrElse(phase, 0L) + (System.nanoTime() - start))
    })
  }

  def summary: String = {
    val countsStr =
      if (counters.isEmpty) "none" else counters.toSeq.map { case (key, value) => s"$key=$value" }.mkString(", ")
    val timingsStr =
      if (phaseDurationsNanos.isEmpty) "none"
      else
        phaseDurationsNanos.toSeq.sortBy { case (_, nanos) => -nanos }.map { case (phase, nanos) =>
          f"$phase=${nanos / 1e6}%.0fms"
        }.mkString(", ")
    s"requestShape=[$requestShapeSummary]; counts=[$countsStr]; phaseDurations=[$timingsStr]"
  }
}
