package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Box
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction

import scala.concurrent.ExecutionContext

trait BucketProvider {
  def load(readInstruction: DataReadInstruction)(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]]

  def loadMultiple(
      readInstructions: Seq[DataReadInstruction]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[Box[Array[Byte]]]] =
    Fox.fromFuture(Fox.serialSequence(readInstructions) { readInstruction =>
      load(readInstruction)
    })

  /** Loads the buckets of one cuboid, concurrently by default. Providers that can fetch several buckets with one
    * request override this, so that a cuboid costs one request instead of one per bucket.
    */
  def loadForCuboid(
      readInstructions: Seq[DataReadInstruction]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[Box[Array[Byte]]]] =
    Fox.fromFuture(Fox.sequence(readInstructions.toList.map(load)))
}
