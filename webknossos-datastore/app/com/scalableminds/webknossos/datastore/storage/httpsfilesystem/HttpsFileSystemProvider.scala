package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import java.net.URI
import java.nio.channels.SeekableByteChannel
import java.nio.file.attribute.{BasicFileAttributes, FileAttribute, FileAttributeView}
import java.nio.file.spi.FileSystemProvider
import java.nio.file._
import java.util
import java.util.concurrent.ConcurrentHashMap

import com.google.common.collect.ImmutableMap
import com.typesafe.scalalogging.LazyLogging

class HttpsFileSystemProvider extends FileSystemProvider with LazyLogging {
  protected val fileSystems: ConcurrentHashMap[String, HttpsFileSystem] = new ConcurrentHashMap[String, HttpsFileSystem]

  override def getScheme: String = "https"

  override def newFileSystem(uri: URI, env: util.Map[String, _]): FileSystem = {
    if (uri.getUserInfo != null && uri.getUserInfo.nonEmpty) {
      throw new Exception("Username was supplied in uri, should be in env instead.")
    }
    val basicAuthCredentials = HttpsBasicAuthCredentials.fromEnvMap(env)
    val key = fileSystemKey(uri, basicAuthCredentials)
    if (fileSystems.containsKey(key)) {
      throw new FileSystemAlreadyExistsException("File system " + key + " already exists")
    }

    val fileSystem = new HttpsFileSystem(provider = this, uri = uri, basicAuthCredentials = basicAuthCredentials)

    fileSystems.put(fileSystem.getKey, fileSystem)

    fileSystem
  }

  def fileSystemKey(uri: URI, basicAuthCredentials: Option[HttpsBasicAuthCredentials]): String = {
    val uriWithUser = basicAuthCredentials.map { c =>
      new URI(uri.getScheme, c.user, uri.getHost, uri.getPort, uri.getPath, uri.getQuery, uri.getFragment)
    }.getOrElse(uri)
    uriWithUser.toString
  }

  override def getFileSystem(uri: URI): FileSystem = {
    val key = fileSystemKey(uri, None)
    if (fileSystems.containsKey(key)) {
      fileSystems.get(key)
    } else this.newFileSystem(uri, ImmutableMap.builder[String, Any].build())
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
