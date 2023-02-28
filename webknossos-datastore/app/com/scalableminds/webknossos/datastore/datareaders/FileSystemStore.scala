package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.util.io.ZipIO
import com.scalableminds.webknossos.datastore.storage.httpsfilesystem.ByteChannelOptions
import net.liftweb.common.{EmptyBox, Full}
import net.liftweb.util.Helpers.tryo

import java.nio.ByteBuffer
import java.nio.file.{Files, OpenOption, Path}

class FileSystemStore(val internalRoot: Path) {
  def readBytes(key: String): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    tryo(Files.readAllBytes(path)).toOption.map(ZipIO.tryGunzip)
  }

  def readByteRange(key: String, range: Range, useCustomRangeOption: Boolean = false): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    val optionSet = new java.util.HashSet[OpenOption]()

    if (useCustomRangeOption) {
      optionSet.add(ByteChannelOptions.RANGE)
    }
    val channel = path.getFileSystem.provider().newByteChannel(path, optionSet)
    val buf = ByteBuffer.allocateDirect(range.length)
    channel.position(range.start)
    val box = tryo(channel.read(buf))
    buf.position(0)
    box match {
      case Full(length) =>
        val arr = new Array[Byte](length)
        buf.get(arr)
        Some(arr)
      case box: EmptyBox => None
    }
  }
}
