package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.geometry.BoundingBoxProto as ProtoBoundingBox
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryConversions

// Mark where a bounding box came from during merge for lookup in the correct id map
object BoundingBoxSource extends ExtendedEnumeration {
  val singleA, singleB, userA, userB = Value
}

trait BoundingBoxMerger extends ProtoGeometryConversions {

  protected type UserBboxIdMap = Map[Int, Int]

  protected def combineBoundingBoxes(
      boundingBoxAOpt: Option[ProtoBoundingBox],
      boundingBoxBOpt: Option[ProtoBoundingBox]
  ): Option[ProtoBoundingBox] =
    for {
      boundinBoxA <- boundingBoxAOpt
      boundinBoxB <- boundingBoxBOpt
      union = BoundingBox.union(
        List[BoundingBox](
          boundingBoxFromProto(boundinBoxA),
          boundingBoxFromProto(boundinBoxB)
        )
      )
    } yield boundingBoxToProto(union)

  // Bounding boxes are the one merged element type that supports content-based deduplication (unlike
  // node, tree, group or segment ids, which never carry duplicate meaning and so always follow the
  // simpler "A fixed, B remapped" convention used everywhere else, see TreeUtils/GroupUtils/MergedVolume).
  // A duplicate pair can involve two boxes from the same tracing, so both sides may need renumbering:
  // all of A's and B's boxes (plus their deprecated legacy single-box fields) are pooled, deduplicated
  // by content, and renumbered from scratch. Both idMapA and idMapB are returned and must be applied to
  // that tracing's own user states, unlike the other merged elements where only B's user state needs it.
  protected def combineUserBoundingBoxes(
      singleBoundingBoxAOpt: Option[ProtoBoundingBox],
      singleBoundingBoxBOpt: Option[ProtoBoundingBox],
      userBoundingBoxesA: Seq[NamedBoundingBoxProto],
      userBoundingBoxesB: Seq[NamedBoundingBoxProto]
  ): (Seq[NamedBoundingBoxProto], UserBboxIdMap, UserBboxIdMap) = {
    // note that the singleBoundingBox field is deprecated but still supported here to avoid database evolutions
    val singleBoundingBoxANamed =
      singleBoundingBoxAOpt.map(bb => (NamedBoundingBoxProto(0, boundingBox = bb), BoundingBoxSource.singleA))
    val singleBoundingBoxBNamed =
      singleBoundingBoxBOpt.map(bb => (NamedBoundingBoxProto(0, boundingBox = bb), BoundingBoxSource.singleB))

    val allBoundingBoxes: Seq[(NamedBoundingBoxProto, BoundingBoxSource.Value)] = userBoundingBoxesA.map(
      (_, BoundingBoxSource.userA)
    ) ++ userBoundingBoxesB.map((_, BoundingBoxSource.userB)) ++ singleBoundingBoxANamed ++ singleBoundingBoxBNamed
    val newBoxesAndPrevIds: Seq[(NamedBoundingBoxProto, BoundingBoxSource.Value, Int)] =
      allBoundingBoxes.distinctBy(_._1.copy(id = 0)).zipWithIndex.map { case ((uBB, source), idx) =>
        (uBB.copy(id = idx), source, uBB.id)
      }

    val idMapA: Map[Int, Int] = newBoxesAndPrevIds.flatMap {
      case (newBox, source, oldId) if source == BoundingBoxSource.userA => Some((oldId, newBox.id))
      case _                                                            => None
    }.toMap
    val idMapB: Map[Int, Int] = newBoxesAndPrevIds.flatMap {
      case (newBox, source, oldId) if source == BoundingBoxSource.userB => Some((oldId, newBox.id))
      case _                                                            => None
    }.toMap
    val newBoxes = newBoxesAndPrevIds.map(_._1)
    (newBoxes, idMapA, idMapB)
  }

  protected def addAdditionalBoundingBoxes(
      originalBoundingBoxes: Seq[NamedBoundingBoxProto],
      additionalBoundingBoxes: Seq[NamedBoundingBox]
  ): Seq[NamedBoundingBoxProto] = {
    val idOffset = originalBoundingBoxes.map(_.id).maxOption.getOrElse(-1) + 1
    val additionalAdapted = additionalBoundingBoxes.zipWithIndex.map { case (bb, idx) =>
      bb.copy(id = idx + idOffset).toProto
    }
    originalBoundingBoxes ++ additionalAdapted
  }

}
