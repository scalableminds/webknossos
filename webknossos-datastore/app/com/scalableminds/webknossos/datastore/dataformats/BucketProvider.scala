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
}
