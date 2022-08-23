package com.scalableminds.webknossos.datastore.jzarr

import java.nio.file.{Files, Path}

import net.liftweb.common.Box.tryo

class FileSystemStore(val internalRoot: Path) {
  def readBytes(key: String): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    tryo(Files.readAllBytes(path)).toOption
  }
}
