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

  protected def migrations: List[T => Fox[T]]

  def migrateTracing(tracing: T): Fox[T] = {
    def migrateIter(tracingFox: Fox[T], migrations: List[T => Fox[T]]): Fox[T] =
      migrations match {
        case List() => tracingFox
        case head :: tail =>
          tracingFox.futureBox.flatMap {
            case Full(tracing) =>
              migrateIter(head(tracing), tail)
            case x => box2Fox(x)
          }
      }

    migrateIter(Fox.successful(tracing), migrations)
  }
}

class SkeletonTracingMigrationService @Inject()()(implicit val ec: ExecutionContext)
    extends TracingMigrationService[SkeletonTracing]
    with ColorGenerator {
  override protected val migrations: List[SkeletonTracing => Fox[SkeletonTracing]] = List(removeSingleUserBoundingBox)

  private def removeSingleUserBoundingBox(tracing: SkeletonTracing): Fox[SkeletonTracing] = {
    val newUserBoundingBox: Option[ProtoBox] = tracing.userBoundingBox.map { bb =>
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      ProtoBox(newId, color = Some(getRandomColor), boundingBox = bb)
    }
    Fox.successful(tracing.clearUserBoundingBox.addAllUserBoundingBoxes(newUserBoundingBox))
  }
}

class VolumeTracingMigrationService @Inject()()(implicit val ec: ExecutionContext)
    extends TracingMigrationService[VolumeTracing]
    with ColorGenerator {
  override protected val migrations: List[VolumeTracing => Fox[VolumeTracing]] = List(removeSingleUserBoundingBox)

  private def removeSingleUserBoundingBox(tracing: VolumeTracing): Fox[VolumeTracing] = {
    val newUserBoundingBox: Option[ProtoBox] = tracing.userBoundingBox.map { bb =>
      val newId = if (tracing.userBoundingBoxes.isEmpty) 1 else tracing.userBoundingBoxes.map(_.id).max + 1
      ProtoBox(newId, color = Some(getRandomColor), boundingBox = bb)
    }
    Fox.successful(tracing.clearUserBoundingBox.addAllUserBoundingBoxes(newUserBoundingBox))
  }
}
