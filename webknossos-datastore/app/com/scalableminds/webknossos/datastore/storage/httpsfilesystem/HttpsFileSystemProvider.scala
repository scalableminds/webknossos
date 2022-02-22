package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import java.net.URI
import java.nio.channels.SeekableByteChannel
import java.nio.file.attribute.{BasicFileAttributes, FileAttribute, FileAttributeView}
import java.nio.file.spi.FileSystemProvider
import java.nio.file._
import java.util

import com.typesafe.scalalogging.LazyLogging

class HttpsFileSystemProvider extends FileSystemProvider with LazyLogging {
  override def getScheme: String = "https"

  override def newFileSystem(uri: URI, map: util.Map[String, _]): FileSystem = {
    logger.info(s"getFileSystem for ${uri}")
    new HttpsFileSystem(provider = this, uri = uri)
  }

  override def getFileSystem(uri: URI): FileSystem = {
    // TODO cache existing file systems
    logger.info(s"getFileSystem for ${uri}")
    new HttpsFileSystem(provider = this, uri = uri)
  }

  override def getPath(uri: URI): Path =
    getFileSystem(uri).getPath(uri.getPath)

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
