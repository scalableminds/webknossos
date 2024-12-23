package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import scala.concurrent.ExecutionContext

trait BucketProvider {
  def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[Array[Byte]]
}
