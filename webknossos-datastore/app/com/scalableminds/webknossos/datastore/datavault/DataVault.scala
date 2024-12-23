package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

trait DataVault {
  def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)]

  def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]]
}
