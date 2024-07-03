package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

trait DataVault {
  val MAX_EXPLORED_ITEMS_PER_LEVEL = 10
  def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)]

  def listDirectory(path: VaultPath)(implicit ec: ExecutionContext): Fox[List[VaultPath]]
}
