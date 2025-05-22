package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.geometry.{NamedBoundingBoxProto => ProtoNamedBoundingBox}
import com.scalableminds.webknossos.datastore.geometry.{BoundingBoxProto => ProtoBoundingBox}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits

trait BoundingBoxMerger extends ProtoGeometryImplicits {
  private val BBOX_SOURCE_SINGLE_A = 0
  private val BBOX_SOURCE_SINGLE_B = 1
  private val BBOX_SOURCE_USER_A = 2
  private val BBOX_SOURCE_USER_B = 3

  protected type UserBboxIdMap = Map[Int, Int]
  private type BboxSource = Int // TODO use enum?

  protected def combineBoundingBoxes(boundingBoxAOpt: Option[ProtoBoundingBox],
                                     boundingBoxBOpt: Option[ProtoBoundingBox]): Option[ProtoBoundingBox] =
    for {
      boundinBoxA <- boundingBoxAOpt
      boundinBoxB <- boundingBoxBOpt
    } yield {
      com.scalableminds.util.geometry.BoundingBox
        .union(List[com.scalableminds.util.geometry.BoundingBox](boundinBoxA, boundinBoxB))
    }

  protected def combineUserBoundingBoxes(singleBoundingBoxAOpt: Option[ProtoBoundingBox],
                                         singleBoundingBoxBOpt: Option[ProtoBoundingBox],
                                         userBoundingBoxesA: Seq[ProtoNamedBoundingBox],
                                         userBoundingBoxesB: Seq[ProtoNamedBoundingBox],
  ): (Seq[ProtoNamedBoundingBox], UserBboxIdMap, UserBboxIdMap) = {
    // note that the singleBoundingBox field is deprecated but still supported here to avoid database evolutions
    val singleBoundingBoxANamed =
      singleBoundingBoxAOpt.map(bb => (ProtoNamedBoundingBox(0, boundingBox = bb), BBOX_SOURCE_SINGLE_A))
    val singleBoundingBoxBNamed =
      singleBoundingBoxBOpt.map(bb => (ProtoNamedBoundingBox(0, boundingBox = bb), BBOX_SOURCE_SINGLE_B))

    val allBoundingBoxes
      : Seq[(ProtoNamedBoundingBox, Int)] = userBoundingBoxesA.map((_, BBOX_SOURCE_USER_A)) ++ userBoundingBoxesB.map(
      (_, BBOX_SOURCE_USER_B)) ++ singleBoundingBoxANamed ++ singleBoundingBoxBNamed
    val newBoxesAndPrevIds: Seq[(ProtoNamedBoundingBox, BboxSource, Int)] =
      allBoundingBoxes.distinctBy(_._1.copy(id = 0)).zipWithIndex.map {
        case ((uBB, source), idx) => (uBB.copy(id = idx), source, uBB.id)
      }

    val idMapA: Map[Int, Int] = newBoxesAndPrevIds.flatMap {
      case (newBox, source, oldId) if source == BBOX_SOURCE_USER_A => Some((oldId, newBox.id))
      case _                                                       => None
    }.toMap
    val idMapB: Map[Int, Int] = newBoxesAndPrevIds.flatMap {
      case (newBox, source, oldId) if source == BBOX_SOURCE_USER_B => Some((oldId, newBox.id))
      case _                                                       => None
    }.toMap
    val newBoxes = newBoxesAndPrevIds.map(_._1)
    (newBoxes, idMapA, idMapB)
  }

}
