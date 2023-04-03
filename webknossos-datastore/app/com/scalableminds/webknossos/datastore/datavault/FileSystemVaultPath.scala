package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.io.ZipIO
import net.liftweb.util.Helpers.tryo

import java.net.URI
import java.nio.file.Path
import scala.collection.immutable.NumericRange

class FileSystemVaultPath(basePath: Path, dataVault: FileSystemDataVault)
    extends VaultPath(uri = new URI(""), dataVault = dataVault) {

  override def readBytes(range: Option[NumericRange[Long]] = None): Option[Array[Byte]] =
    tryo(dataVault.readBytesLocal(basePath, range)).toOption.map(ZipIO.tryGunzip)

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
