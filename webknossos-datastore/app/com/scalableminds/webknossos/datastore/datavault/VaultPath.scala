package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.io.ZipIO
import net.liftweb.util.Helpers.tryo

import java.net.URI
import java.nio.file.{FileSystem, LinkOption, Path, Paths, WatchEvent, WatchKey, WatchService}
import scala.collection.immutable.NumericRange

/*
VaultPath implements Path so that a drop in replacement is possible while continuing to use Paths for local storage.
This class does not implement all relevant methods and it might be a good idea to remove the inheritance on Path in the
future.
 */

class VaultPath(uri: URI, dataVault: DataVault) extends Path {

  protected def readBytesGet(range: Option[NumericRange[Long]]): Array[Byte] =
    dataVault.readBytes(this, range)

  def readBytes(range: Option[NumericRange[Long]] = None): Option[Array[Byte]] =
    tryo(readBytesGet(range)).toOption.map(ZipIO.tryGunzip)

  override def getFileSystem: FileSystem = ???

  override def isAbsolute: Boolean = ???

  override def getRoot: Path = ???

  override def getFileName: Path =
    Paths.get(uri.toString.split("/").last)

  override def getParent: Path = {
    val newUri =
      if (uri.getPath.endsWith("/")) uri.resolve("..")
      else uri.resolve(".")
    new VaultPath(newUri, dataVault)
  }

  override def getNameCount: Int = ???

  override def getName(index: Int): Path = ???

  override def subpath(beginIndex: Int, endIndex: Int): Path = ???

  override def startsWith(other: Path): Boolean = ???

  override def endsWith(other: Path): Boolean = ???

  override def normalize(): Path = ???

  override def resolve(other: String): Path = this / other

  override def resolve(other: Path): Path = this / other.toString

  def /(key: String): VaultPath =
    if (uri.toString.endsWith("/")) {
      new VaultPath(uri.resolve(key), dataVault)
    } else {
      new VaultPath(new URI(s"${uri.toString}/").resolve(key), dataVault)
    }

  override def relativize(other: Path): Path = ???

  override def toUri: URI =
    uri

  override def toAbsolutePath: Path = ???

  override def compareTo(other: Path): Int = ???

  override def toRealPath(options: LinkOption*): Path = ???

  override def register(watcher: WatchService,
                        events: Array[WatchEvent.Kind[_]],
                        modifiers: WatchEvent.Modifier*): WatchKey = ???

  override def toString: String = uri.toString

  def getName: String = s"VaultPath: ${this.toString} for ${dataVault.getClass.getSimpleName}"
}
