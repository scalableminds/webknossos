package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import java.io.File
import java.net.URI
import java.nio.file.{FileSystem, LinkOption, Path, WatchEvent, WatchKey, WatchService}

class HttpsPath(uri: URI, fileSystem: HttpsFileSystem) extends Path {
  override def getFileSystem: FileSystem = fileSystem

  override def isAbsolute: Boolean = ???

  override def getRoot: Path = ???

  override def getFileName: Path = ???

  override def getParent: Path = ???

  override def getNameCount: Int = ???

  override def getName(i: Int): Path = ???

  override def subpath(i: Int, i1: Int): Path = ???

  override def startsWith(path: Path): Boolean = ???

  override def startsWith(s: String): Boolean = ???

  override def endsWith(path: Path): Boolean = ???

  override def endsWith(s: String): Boolean = uri.getPath.endsWith(s)

  override def normalize(): Path = ???

  override def resolve(path: Path): Path =
    // trailing slash added to avoid resolving in the parent level. Note that consecutive slashes are removed
    new HttpsPath(URI.create(uri.toString + "/").resolve(path.toString), fileSystem)

  override def resolve(s: String): Path = new HttpsPath(URI.create(uri.toString + "/").resolve(s), fileSystem)

  override def resolveSibling(path: Path): Path = ???

  override def resolveSibling(s: String): Path = ???

  override def relativize(path: Path): Path = ???

  override def toUri: URI = uri

  override def toAbsolutePath: Path = ???

  override def toRealPath(linkOptions: LinkOption*): Path = ???

  override def toFile: File = ???

  override def register(watchService: WatchService,
                        kinds: Array[WatchEvent.Kind[_]],
                        modifiers: WatchEvent.Modifier*): WatchKey = ???

  override def register(watchService: WatchService, kinds: WatchEvent.Kind[_]*): WatchKey = ???

  override def iterator(): java.util.Iterator[Path] = ???

  override def compareTo(path: Path): Int = ???

  def getKey: String = uri.toString

  override def toString: String = s"HttpsPath(${uri.toString})@${hashCode()}"

  def getBasicAuthCredentials: Option[HttpsBasicAuthCredentials] = fileSystem.getBasicAuthCredentials
}
