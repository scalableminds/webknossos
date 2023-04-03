package com.scalableminds.webknossos.datastore.datavault

import java.nio.ByteBuffer
import java.nio.file.{Files, Path}
import scala.collection.immutable.NumericRange

class FileSystemDataVault extends DataVault {
  override def readBytes(path: VaultPath, range: Option[NumericRange[Long]]): Array[Byte] = ???

  def readBytesLocal(path: Path, range: Option[NumericRange[Long]]): Array[Byte] =
    range match {
      case None => Files.readAllBytes(path)
      case Some(r) =>
        val channel = Files.newByteChannel(path)
        val buf = ByteBuffer.allocateDirect(r.length)
        channel.position(r.start)
        channel.read(buf)
        buf.position(0)
        val arr = new Array[Byte](r.length)
        buf.get(arr)
        arr
    }
}
object FileSystemDataVault {
  def create: FileSystemDataVault = new FileSystemDataVault
}
