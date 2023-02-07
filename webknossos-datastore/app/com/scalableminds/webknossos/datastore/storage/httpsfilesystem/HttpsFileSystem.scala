package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

import com.scalableminds.webknossos.datastore.storage.HttpBasicAuthCredential

import java.net.URI
import java.nio.file._
import java.nio.file.attribute.UserPrincipalLookupService
import java.nio.file.spi.FileSystemProvider
import java.{lang, util}

object HttpsFileSystem {
  def forUri(uri: URI, credential: Option[HttpBasicAuthCredential] = None): HttpsFileSystem = {

    val key = HttpsFileSystemProvider.fileSystemKey(uri, None)
    if (HttpsFileSystemProvider.fileSystems.containsKey(key)) {
      HttpsFileSystemProvider.fileSystems.get(key)
    } else {
      val fileSystem = new HttpsFileSystem(new HttpsFileSystemProvider, uri, credential)
      HttpsFileSystemProvider.fileSystems.put(key, fileSystem)
      fileSystem
    }
  }

}

class HttpsFileSystem(provider: HttpsFileSystemProvider,
                      uri: URI,
                      basicAuthCredential: Option[HttpBasicAuthCredential] = None)
    extends FileSystem {
  override def provider(): FileSystemProvider = provider

  override def close(): Unit = ???

  override def isOpen: Boolean = ???

  override def isReadOnly: Boolean = ???

  override def getSeparator: String = ???

  override def getRootDirectories: lang.Iterable[Path] = ???

  override def getFileStores: lang.Iterable[FileStore] = ???

  override def supportedFileAttributeViews(): util.Set[String] = ???

  override def getPath(s: String, strings: String*): Path =
    new HttpsPath(uri.resolve(s), fileSystem = this)

  override def getPathMatcher(s: String): PathMatcher = ???

  override def getUserPrincipalLookupService: UserPrincipalLookupService = ???

  override def newWatchService(): WatchService = ???

  def getKey: String = HttpsFileSystemProvider.fileSystemKey(uri, basicAuthCredential)

  def getBasicAuthCredential: Option[HttpBasicAuthCredential] = basicAuthCredential
}
