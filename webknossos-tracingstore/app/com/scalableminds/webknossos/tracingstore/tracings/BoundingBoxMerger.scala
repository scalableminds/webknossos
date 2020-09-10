package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.tracingstore.geometry.{NamedBoundingBox => ProtoNamedBoundingBox}
import com.scalableminds.webknossos.tracingstore.geometry.{BoundingBox => ProtoBoundingBox}

trait BoundingBoxMerger extends ProtoGeometryImplicits {

  protected def combineBoundingBoxes(boundingBoxAOpt: Option[ProtoBoundingBox],
                                     boundingBoxBOpt: Option[ProtoBoundingBox]): Option[ProtoBoundingBox] =
    for {
      boundinBoxA <- boundingBoxAOpt
      boundinBoxB <- boundingBoxBOpt
    } yield {
      com.scalableminds.util.geometry.BoundingBox
        .combine(List[com.scalableminds.util.geometry.BoundingBox](boundinBoxA, boundinBoxB))
    }

  protected def combineUserBoundingBoxes(singleBoundingBoxAOpt: Option[ProtoBoundingBox],
                                         singleBoundingBoxBOpt: Option[ProtoBoundingBox],
                                         userBoundingBoxesA: Seq[ProtoNamedBoundingBox],
                                         userBoundingBoxesB: Seq[ProtoNamedBoundingBox],
  ): Seq[ProtoNamedBoundingBox] = {
    // note that the singleBoundingBox field is deprecated but still supported here to avoid database evolutions
    val singleBoundingBoxes =
      (singleBoundingBoxAOpt ++ singleBoundingBoxBOpt).map(bb => ProtoNamedBoundingBox(0, boundingBox = bb))
    (userBoundingBoxesA ++ userBoundingBoxesB ++ singleBoundingBoxes).zipWithIndex.map(uBB => uBB._1.copy(id = uBB._2))
  }

}
