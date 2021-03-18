package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.{Color, NamedBoundingBox => ProtoBox}
import net.liftweb.common.Full
import scalapb.{GeneratedMessage, Message}

import scala.concurrent.ExecutionContext.Implicits.global

trait ColorGenerator {
  private def getRandomComponent: Double =
    Math.random()

  def getRandomColor: Color =
    Color(getRandomComponent, getRandomComponent, getRandomComponent, 1.0)
}

trait TracingMigrationService[T <: GeneratedMessage with Message[T]] extends FoxImplicits {
  // Each migration transforms a tracing and additionally returns whether the tracing was modified
  def migrations: List[T => Fox[(T, Boolean)]]

  def migrateTracing(tracing: Fox[T]): Fox[(T, Boolean)] = {
    def migrateIter(tracingAndChanged: Fox[(T, Boolean)], migrations: List[T => Fox[(T, Boolean)]]): Fox[(T, Boolean)] =
      migrations match {
        case List() => tracingAndChanged
        case head :: tail =>
          tracingAndChanged.futureBox.flatMap {
            case Full((tracing, hasChangedPrev)) =>
              migrateIter(head(tracing).map(t => (t._1, hasChangedPrev || t._2)), tail)
            case x => box2Fox(x)
          }
      }

    migrateIter(tracing.map((_, false)), migrations)
  }
}

object SkeletonTracingMigrationService extends TracingMigrationService[SkeletonTracing] with ColorGenerator {
  override val migrations = List(removeSingleUserBoundingBox)

  def removeSingleUserBoundingBox(tracing: SkeletonTracing): Fox[(SkeletonTracing, Boolean)] = {
    val newUserBoundingBox: Option[ProtoBox] = tracing.userBoundingBox.map { bb =>
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      ProtoBox(newId, color = Some(getRandomColor), boundingBox = bb)
    }
    Fox.successful(
      (tracing.clearUserBoundingBox.addAllUserBoundingBoxes(newUserBoundingBox), tracing.userBoundingBox.isDefined))
  }
}

object VolumeTracingMigrationService extends TracingMigrationService[VolumeTracing] with ColorGenerator {
  override val migrations = List(removeSingleUserBoundingBox)

  def removeSingleUserBoundingBox(tracing: VolumeTracing): Fox[(VolumeTracing, Boolean)] = {
    val newUserBoundingBox: Option[ProtoBox] = tracing.userBoundingBox.map { bb =>
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      ProtoBox(newId, color = Some(getRandomColor), boundingBox = bb)
    }
    Fox.successful(
      (tracing.clearUserBoundingBox.addAllUserBoundingBoxes(newUserBoundingBox), tracing.userBoundingBox.isDefined))
  }
}
