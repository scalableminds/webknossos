package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.io.ZipIO
import net.liftweb.util.Helpers.tryo

import java.nio.file.{Files, Path}

class FileSystemStore(val internalRoot: Path) {
  def readBytes(key: String): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    tryo(Files.readAllBytes(path)).toOption.map(ZipIO.tryGunzip)
  }
}
