package com.scalableminds.webknossos.datastore.datavault

import java.net.URI
import java.nio.ByteBuffer
import java.nio.file.{FileSystem, Files, LinkOption, Path, WatchEvent, WatchKey, WatchService}
import scala.collection.immutable.NumericRange

class FileSystemVaultPath(basePath: Path)
    extends VaultPath(uri = new URI(""), dataVault = NullDataVault.create, fileSystemCredentialOpt = None) {

  override def readBytesGet(key: String, range: Option[NumericRange[Long]]): Array[Byte] = {
    val path = basePath.resolve(key)
    range match {
      case Some(r) =>
        val channel = Files.newByteChannel(path)
        val buf = ByteBuffer.allocateDirect(r.length)
        channel.position(r.start)
        channel.read(buf)
        buf.position(0)
        val arr = new Array[Byte](r.length)
        buf.get(arr)
        arr
      case None => Files.readAllBytes(path)
    }
  }

  override def getFileSystem: FileSystem = basePath.getFileSystem

  override def isAbsolute: Boolean = basePath.isAbsolute

  override def getRoot: Path = new FileSystemVaultPath(basePath.getRoot)

  override def getFileName: Path = new FileSystemVaultPath(basePath.getFileName)

  override def getParent: Path = new FileSystemVaultPath(basePath.getParent)

  override def getNameCount: Int = basePath.getNameCount

  override def getName(index: Int): Path = new FileSystemVaultPath(basePath.getName(index))

  override def subpath(beginIndex: Int, endIndex: Int): Path = basePath.subpath(beginIndex: Int, endIndex: Int)

  override def startsWith(other: Path): Boolean = basePath.startsWith(other)

  override def endsWith(other: Path): Boolean = basePath.endsWith(other)

  override def normalize(): Path = new FileSystemVaultPath(basePath.normalize())

  override def resolve(other: Path): Path = new FileSystemVaultPath(basePath.resolve(other))

  override def relativize(other: Path): Path = new FileSystemVaultPath(basePath.relativize(other))

  override def toUri: URI = basePath.toUri

  override def toAbsolutePath: Path = new FileSystemVaultPath(basePath.toAbsolutePath)

  override def toRealPath(options: LinkOption*): Path = ???

  override def register(watcher: WatchService,
                        events: Array[WatchEvent.Kind[_]],
                        modifiers: WatchEvent.Modifier*): WatchKey = ???

  override def compareTo(other: Path): Int = basePath.compareTo(other)

  override def toString: String = basePath.toString
}

object FileSystemVaultPath {
  def fromPath(path: Path): FileSystemVaultPath = new FileSystemVaultPath(path)
}
