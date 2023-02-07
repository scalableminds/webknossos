package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import java.net.URI
import java.nio.channels.SeekableByteChannel
import java.nio.file.attribute.{BasicFileAttributes, FileAttribute, FileAttributeView}
import java.nio.file.spi.FileSystemProvider
import java.nio.file._
import java.util
import java.util.concurrent.ConcurrentHashMap
import com.scalableminds.webknossos.datastore.storage.HttpBasicAuthCredential
import com.typesafe.scalalogging.LazyLogging

object HttpsFileSystemProvider {
  val fileSystems: ConcurrentHashMap[String, HttpsFileSystem] = new ConcurrentHashMap[String, HttpsFileSystem]

  def fileSystemKey(uri: URI, basicAuthCredentials: Option[HttpBasicAuthCredential]): String = {
    val uriWithUser = basicAuthCredentials.map { c =>
      new URI(uri.getScheme, c.user, uri.getHost, uri.getPort, uri.getPath, uri.getQuery, uri.getFragment)
    }.getOrElse(uri)
    uriWithUser.toString
  }
}

class HttpsFileSystemProvider extends FileSystemProvider with LazyLogging {

  override def getScheme: String = "https" // Note that it will also handle http if called with one

  override def newFileSystem(uri: URI, env: util.Map[String, _]): FileSystem = ???

  override def getFileSystem(uri: URI): FileSystem = ???

  override def getPath(uri: URI): Path = ???

  override def newByteChannel(path: Path,
                              openOptions: util.Set[_ <: OpenOption],
                              fileAttributes: FileAttribute[_]*): SeekableByteChannel =
    new HttpsSeekableByteChannel(path.asInstanceOf[HttpsPath], openOptions)

  override def newDirectoryStream(path: Path, filter: DirectoryStream.Filter[_ >: Path]): DirectoryStream[Path] = ???

  override def createDirectory(path: Path, fileAttributes: FileAttribute[_]*): Unit = ???

  override def delete(path: Path): Unit = ???

  override def copy(path: Path, path1: Path, copyOptions: CopyOption*): Unit = ???

  override def move(path: Path, path1: Path, copyOptions: CopyOption*): Unit = ???

  override def isSameFile(path: Path, path1: Path): Boolean = ???

  override def isHidden(path: Path): Boolean = ???

  override def getFileStore(path: Path): FileStore = ???

  override def checkAccess(path: Path, accessModes: AccessMode*): Unit = ???

  override def getFileAttributeView[V <: FileAttributeView](path: Path, aClass: Class[V], linkOptions: LinkOption*): V =
    ???

  override def readAttributes[A <: BasicFileAttributes](path: Path, aClass: Class[A], linkOptions: LinkOption*): A = ???

  override def readAttributes(path: Path, s: String, linkOptions: LinkOption*): util.Map[String, AnyRef] = ???

  override def setAttribute(path: Path, s: String, o: Any, linkOptions: LinkOption*): Unit = ???
}
