package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import net.liftweb.common.Box

import scala.concurrent.ExecutionContext

trait BucketProvider {
  def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]]

  def loadMultiple(readInstructions: Seq[DataReadInstruction])(implicit ec: ExecutionContext,
                                                               tc: TokenContext): Fox[Seq[Box[Array[Byte]]]] =
    Fox.future2Fox(Fox.serialSequenceBox(readInstructions) { readInstruction =>
      load(readInstruction)
    })
}
