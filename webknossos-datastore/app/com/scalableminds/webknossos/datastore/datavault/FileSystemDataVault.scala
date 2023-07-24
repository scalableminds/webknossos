package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import net.liftweb.util.Helpers.tryo

import java.nio.ByteBuffer
import java.nio.file.{Files, Path}
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class FileSystemDataVault extends DataVault {
  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = ???

  def readBytesLocal(path: Path, range: Option[NumericRange[Long]])(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    if (Files.exists(path)) {
      range match {
        case None => tryo(Files.readAllBytes(path)).toFox
        case Some(r) =>
          tryo {
            val channel = Files.newByteChannel(path)
            val buf = ByteBuffer.allocateDirect(r.length)
            channel.position(r.start)
            channel.read(buf)
            buf.position(0)
            val arr = new Array[Byte](r.length)
            buf.get(arr)
            arr
          }.toFox
      }
    } else Fox.empty
}

object FileSystemDataVault {
  def create: FileSystemDataVault = new FileSystemDataVault
}
