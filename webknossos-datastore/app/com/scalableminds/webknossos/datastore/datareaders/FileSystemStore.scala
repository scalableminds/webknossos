package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.webknossos.datastore.storage.httpsfilesystem.HttpsPath
import net.liftweb.util.Helpers.tryo

import java.net.URI
import java.nio.file.{FileSystem, Files, Path, Paths}

class FileSystemStore(val internalRoot: Path) {
  def readBytes(key: String): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    tryo(Files.readAllBytes(path)).toOption
  }
}

class GoogleCloudFileSystemStore(override val internalRoot: Path, fs: FileSystem)
    extends FileSystemStore(internalRoot) {

  private def normalizedInternalRoot = {
    def prefix = internalRoot.getParent.toString // This part uses "/"
    def normalPart = prefix.substring(0, prefix.length - 1)
    def child = internalRoot.toString.split("/").last
    s"$normalPart%2F$child"
  }

  override def readBytes(key: String): Option[Array[Byte]] = {
    val path = s"$normalizedInternalRoot%2F$key?alt=media"
    tryo(Files.readAllBytes(fs.getPath(path))).toOption
  }
}
