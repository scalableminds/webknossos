package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

trait DataVault {
  def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[(Array[Byte], Encoding.Value)]

  def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]]

  def getUsedStorageBytes(path: VaultPath)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long]
}
