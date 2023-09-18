package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox

import java.net.URI
import java.nio.file.Path
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class FileSystemVaultPath(basePath: Path, dataVault: FileSystemDataVault)
    extends VaultPath(uri = new URI(""), dataVault = dataVault) {

  override def readBytes(range: Option[NumericRange[Long]] = None)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    dataVault.readBytesLocal(basePath, RangeSpecifier.fromRangeOpt(range))

  override def readLastBytes(byteCount: Int)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    dataVault.readBytesLocal(basePath, SuffixLength(byteCount))

  override def basename: String = basePath.getFileName.toString

  override def parent: VaultPath = new FileSystemVaultPath(basePath.getParent, dataVault)

  override def /(key: String): VaultPath = new FileSystemVaultPath(basePath.resolve(key), dataVault)

  override def toUri: URI = basePath.toUri

  override def toString: String = basePath.toString

  def exists: Boolean = basePath.toFile.exists()
}

object FileSystemVaultPath {
  def fromPath(path: Path): FileSystemVaultPath = new FileSystemVaultPath(path, FileSystemDataVault.create)
}
