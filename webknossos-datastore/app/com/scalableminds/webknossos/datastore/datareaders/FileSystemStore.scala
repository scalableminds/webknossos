package com.scalableminds.webknossos.datastore.datareaders

import com.typesafe.scalalogging.LazyLogging
import net.liftweb.util.Helpers.tryo

import java.nio.file.{Files, Path}

class FileSystemStore(val internalRoot: Path) extends LazyLogging {
  def readBytes(key: String): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    val result = tryo(Files.readAllBytes(path)).toOption
    result.foreach(data =>
      if (data.length == 0) {
        logger.warn(s"Remote read succeeded but returned zero-byte array at ${path.toUri}")
    })
    result
  }
}
