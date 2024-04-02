package com.scalableminds.webknossos.tracingstore.tracings

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.{ColorProto, NamedBoundingBoxProto => ProtoBox}
import net.liftweb.common.Full
import scalapb.GeneratedMessage

import scala.concurrent.ExecutionContext

trait ColorGenerator {
  private def getRandomComponent: Double =
    Math.random()

  def getRandomColor: ColorProto =
    ColorProto(getRandomComponent, getRandomComponent, getRandomComponent, 1.0)
}

trait TracingMigrationService[T <: GeneratedMessage] extends FoxImplicits {
  implicit protected def ec: ExecutionContext

  // Each migration transforms a tracing and additionally returns whether the tracing was modified
  protected def migrations: List[T => Fox[(T, Boolean)]]

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

class SkeletonTracingMigrationService @Inject()()(implicit val ec: ExecutionContext)
    extends TracingMigrationService[SkeletonTracing]
    with ColorGenerator {
  override protected val migrations: List[SkeletonTracing => Fox[(SkeletonTracing, Boolean)]] = List(
    removeSingleUserBoundingBox)

  private def removeSingleUserBoundingBox(tracing: SkeletonTracing): Fox[(SkeletonTracing, Boolean)] = {
    val newUserBoundingBox: Option[ProtoBox] = tracing.userBoundingBox.map { bb =>
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      ProtoBox(newId, color = Some(getRandomColor), boundingBox = bb)
    }
    Fox.successful(
      (tracing.clearUserBoundingBox.addAllUserBoundingBoxes(newUserBoundingBox), tracing.userBoundingBox.isDefined))
  }
}

class VolumeTracingMigrationService @Inject()()(implicit val ec: ExecutionContext)
    extends TracingMigrationService[VolumeTracing]
    with ColorGenerator {
  override protected val migrations: List[VolumeTracing => Fox[(VolumeTracing, Boolean)]] = List(
    removeSingleUserBoundingBox)

  private def removeSingleUserBoundingBox(tracing: VolumeTracing): Fox[(VolumeTracing, Boolean)] = {
    val newUserBoundingBox: Option[ProtoBox] = tracing.userBoundingBox.map { bb =>
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      ProtoBox(newId, color = Some(getRandomColor), boundingBox = bb)
    }
    Fox.successful(
      (tracing.clearUserBoundingBox.addAllUserBoundingBoxes(newUserBoundingBox), tracing.userBoundingBox.isDefined))
  }
}
