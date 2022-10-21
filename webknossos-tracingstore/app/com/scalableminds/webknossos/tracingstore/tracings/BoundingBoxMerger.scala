package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.geometry.{NamedBoundingBoxProto => ProtoNamedBoundingBox}
import com.scalableminds.webknossos.datastore.geometry.{BoundingBoxProto => ProtoBoundingBox}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits

trait BoundingBoxMerger extends ProtoGeometryImplicits {

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
  ): Seq[ProtoNamedBoundingBox] = {
    // note that the singleBoundingBox field is deprecated but still supported here to avoid database evolutions
    val singleBoundingBoxes =
      (singleBoundingBoxAOpt ++ singleBoundingBoxBOpt).map(bb => ProtoNamedBoundingBox(0, boundingBox = bb))

    var boundingBoxMap: Map[Any, ProtoNamedBoundingBox] = Map()
    (userBoundingBoxesA ++ userBoundingBoxesB ++ singleBoundingBoxes).foreach(uBB =>
      boundingBoxMap += ((uBB.boundingBox, uBB.name, uBB.color, uBB.isVisible) -> uBB))
    boundingBoxMap.values.zipWithIndex.map(uBB => uBB._1.copy(id = uBB._2)).toSeq
  }

}
