package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox
import org.apache.commons.lang3.builder.HashCodeBuilder

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

  private def getBasePath: Path = basePath
  private def getDataVault: DataVault = dataVault

  override def equals(obj: Any): Boolean = obj match {
    case other: FileSystemVaultPath => other.getBasePath == basePath && other.getDataVault == dataVault
    case _                          => false
  }

  override def hashCode(): Int =
    new HashCodeBuilder(13, 37).append(basePath).append(dataVault).toHashCode
}

object FileSystemVaultPath {
  def fromPath(path: Path): FileSystemVaultPath = new FileSystemVaultPath(path, FileSystemDataVault.create)
}
