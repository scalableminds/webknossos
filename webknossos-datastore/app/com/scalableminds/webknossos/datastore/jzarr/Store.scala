package com.scalableminds.webknossos.datastore.jzarr

import java.io._
import java.nio.file.{Files, Path}

trait Store extends Closeable {
  @throws[IOException]
  def getInputStream(key: String): InputStream

  @throws[IOException]
  override def close(): Unit = {}
}

class FileSystemStore(val internalRoot: Path) extends Store {
  @throws[IOException]
  override def getInputStream(key: String): InputStream = {
    val path = internalRoot.resolve(key)
    val bytes = Files.readAllBytes(path)
    new ByteArrayInputStream(bytes)
  }
}
