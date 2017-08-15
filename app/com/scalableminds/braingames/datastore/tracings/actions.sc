import net.liftweb.common.{Box, Full}
import play.api.libs.functional.syntax.unlift
import play.api.libs.json._
import play.api.libs.functional.syntax._

trait Tracing

case class SkeletonTracing(x: Int) extends Tracing

object SkeletonTracing {
  implicit val format = Json.format[SkeletonTracing]
}

case class VolumeTracing(y: String) extends Tracing

object VolumeTracing {
  implicit val format = Json.format[VolumeTracing]
}


///////////////////////////


trait UpdateAction[T <: Tracing] {
  def applyTo(tracing: T): Box[T] = Full(tracing)
}

trait SkeletonUpdateAction extends UpdateAction[SkeletonTracing]

trait VolumeUpdateAction extends UpdateAction[VolumeTracing]

case class SkeletonUpdateAction1(s: String) extends SkeletonUpdateAction

case class SkeletonUpdateAction2(s: String) extends SkeletonUpdateAction

case class VolumeUpdateAction1(v: String) extends VolumeUpdateAction

trait UpdateActionGroup[T <: Tracing] {

  def version: Long

  def timestamp: Long

  def actions: List[UpdateAction[T]]
}

case class SkeletonUpdateActionGroup(version: Long, timestamp: Long, actions: List[SkeletonUpdateAction]) extends UpdateActionGroup[SkeletonTracing]

case class VolumeUpdateActionGroup(version: Long, timestamp: Long, actions: List[VolumeUpdateAction]) extends UpdateActionGroup[VolumeTracing]

// 2 operations:

1. apply list of updates
- called with list of updates, tracing
- returns tracing

2. iterate over groups
- extract timestamps
- verify versions are increasing
- respond with errors if they are not
- call callback for each group
- extract stats
- called with: (tracingId, group, service)

//object UpdateActionGroup {
//  implicit def skeletonUpdateActionGroupFormat: Format[UpdateActionGroup[SkeletonTracing]] =
//    ((__ \ "version").format[Long] ~
//     (__ \ "timestamp").format[Long] ~
//     (__ \ "actions").format[List[UpdateAction[SkeletonTracing]]])(UpdateActionGroup.apply, unlift(UpdateActionGroup.unapply))
//}

//UpdateAction.apply _
