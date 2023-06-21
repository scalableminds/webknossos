package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox

import java.nio.ByteBuffer
import java.nio.file.{Files, Path}
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class FileSystemDataVault extends DataVault {
  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = ???

  def readBytesLocal(path: Path, range: Option[NumericRange[Long]])(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    range match {
      case None => Fox.successful(Files.readAllBytes(path))
      case Some(r) =>
        val channel = Files.newByteChannel(path)
        val buf = ByteBuffer.allocateDirect(r.length)
        channel.position(r.start)
        channel.read(buf)
        buf.position(0)
        val arr = new Array[Byte](r.length)
        buf.get(arr)
        Fox.successful(arr)
    }
}

object FileSystemDataVault {
  def create: FileSystemDataVault = new FileSystemDataVault
}
