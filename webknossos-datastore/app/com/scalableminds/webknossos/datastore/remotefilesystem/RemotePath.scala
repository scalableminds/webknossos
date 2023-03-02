package com.scalableminds.webknossos.datastore.remotefilesystem

import com.scalableminds.webknossos.datastore.storage.{FileSystemCredential, HttpBasicAuthCredential}

import java.net.URI
import java.nio.file.{FileSystem, LinkOption, Path, Paths, WatchEvent, WatchKey, WatchService}

/*
RemotePath is implements Path so that a drop in replacement is possible while continuing to use Paths for local storage.
This class does not implement all relevant methods and it might be a good idea to remove the inheritance on Path in the
future.
 */

class RemotePath(uri: URI, remoteFileSystem: RemoteFileSystem, fileSystemCredentialOpt: Option[FileSystemCredential])
    extends Path {

  private var pathElements: Seq[String] = Seq()

  def get(key: String, range: Option[Range] = None) = remoteFileSystem.get(key, this, range)

  override def getFileSystem: FileSystem = ???

  override def isAbsolute: Boolean = ???

  override def getRoot: Path = ???

  override def getFileName: Path =
    if (pathElements.nonEmpty) {
      Paths.get(pathElements.last)
    } else {
      Paths.get(uri.toString.split("/").last)
    }

  override def getParent: Path =
    if (pathElements.nonEmpty) {
      pathElements = pathElements.init
      this
    } else {
      val newUri =
        if (uri.getPath.endsWith("/")) uri.resolve("..")
        else uri.resolve(".")
      new RemotePath(newUri, remoteFileSystem, fileSystemCredentialOpt)
    }

  override def getNameCount: Int = ???

  override def getName(index: Int): Path = ???

  override def subpath(beginIndex: Int, endIndex: Int): Path = ???

  override def startsWith(other: Path): Boolean = ???

  override def endsWith(other: Path): Boolean = ???

  override def normalize(): Path = ???

  override def resolve(other: Path): Path = this / other.toString

  def /(key: String): Path = {
    pathElements = key match {
      case ".." => pathElements.init
      case "."  => pathElements
      case _    => pathElements :+ key
    }
    this
  }

  override def relativize(other: Path): Path = ???

  override def toUri: URI =
    pathElements.foldLeft(uri)((u, s) => u.resolve(s))

  override def toAbsolutePath: Path = ???

  override def compareTo(other: Path): Int = ???

  override def toRealPath(options: LinkOption*): Path = ???

  override def register(watcher: WatchService,
                        events: Array[WatchEvent.Kind[_]],
                        modifiers: WatchEvent.Modifier*): WatchKey = ???

  def getBasicAuthCredential: Option[HttpBasicAuthCredential] =
    fileSystemCredentialOpt match {
      case Some(c) => {
        c match {
          case h: HttpBasicAuthCredential => Some(h)
          case _                          => None
        }
      }
      case None => None
    }
}
