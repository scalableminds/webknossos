package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

trait DataVault {
  def readBytesPlusEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], Encoding.Value, Option[String])]

  def listDirectory(path: VaultPath, maxItems: Int)(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[VaultPath]]

  def getUsedStorageBytes(path: VaultPath)(using ec: ExecutionContext, tc: TokenContext): Fox[Long]
}
