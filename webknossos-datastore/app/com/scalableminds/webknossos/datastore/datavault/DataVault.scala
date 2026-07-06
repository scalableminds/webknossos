package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox

import scala.concurrent.ExecutionContext

trait DataVault {
  def readBytesEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], Encoding.Value, Option[String])]

  def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[Seq[VaultPath]]

  def getUsedStorageBytes(path: VaultPath)(using ec: ExecutionContext, tc: TokenContext): Fox[Long]
}
