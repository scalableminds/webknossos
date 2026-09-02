package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.datastore.geometry.NamedBoundingBoxProto
import com.scalableminds.webknossos.datastore.geometry.BoundingBoxProto as ProtoBoundingBox
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryConversions

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

  // Merge convention: tracing A's bounding boxes (including its legacy single box) are left untouched,
  // keeping their ids. Tracing B's boxes are deduplicated against A's by content, and any that remain
  // are assigned fresh ids continuing right after A's, then appended (see TreeUtils/GroupUtils for the
  // analogous rule applied to node/tree/group ids).
  protected def combineUserBoundingBoxes(
      singleBoundingBoxAOpt: Option[ProtoBoundingBox],
      singleBoundingBoxBOpt: Option[ProtoBoundingBox],
      userBoundingBoxesA: Seq[NamedBoundingBoxProto],
      userBoundingBoxesB: Seq[NamedBoundingBoxProto]
  ): (Seq[NamedBoundingBoxProto], UserBboxIdMap) = {
    // note that the singleBoundingBox field is deprecated but still supported here to avoid database evolutions
    val singleBoundingBoxANamed = singleBoundingBoxAOpt.map(bb => NamedBoundingBoxProto(0, boundingBox = bb))
    val singleBoundingBoxBNamed = singleBoundingBoxBOpt.map(bb => NamedBoundingBoxProto(0, boundingBox = bb))

    val boxesA: Seq[NamedBoundingBoxProto] = userBoundingBoxesA ++ singleBoundingBoxANamed
    val boxesAByContent: Set[NamedBoundingBoxProto] = boxesA.map(_.copy(id = 0)).toSet

    val idOffset = boxesA.map(_.id).maxOption.getOrElse(-1) + 1
    val newBoxesBWithPrevIds: Seq[(NamedBoundingBoxProto, Int)] =
      (userBoundingBoxesB ++ singleBoundingBoxBNamed)
        .distinctBy(_.copy(id = 0))
        .filterNot(bb => boxesAByContent.contains(bb.copy(id = 0)))
        .zipWithIndex
        .map { case (bb, index) => (bb.copy(id = index + idOffset), bb.id) }

    val idMapB: Map[Int, Int] = newBoxesBWithPrevIds.map { case (newBox, oldId) => (oldId, newBox.id) }.toMap
    val newBoxes = boxesA ++ newBoxesBWithPrevIds.map(_._1)
    (newBoxes, idMapB)
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
