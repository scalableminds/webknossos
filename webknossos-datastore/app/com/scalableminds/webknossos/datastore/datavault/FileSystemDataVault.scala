package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import net.liftweb.util.Helpers.tryo
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.nio.ByteBuffer
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext

class FileSystemDataVault extends DataVault {
  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = ???

  def readBytesLocal(path: Path, range: RangeSpecifier)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    if (Files.exists(path)) {
      range match {
        case Complete() => tryo(Files.readAllBytes(path)).toFox
        case StartEnd(r) =>
          tryo {
            val channel = Files.newByteChannel(path)
            val buf = ByteBuffer.allocateDirect(r.length)
            channel.position(r.start)
            channel.read(buf)
            buf.rewind()
            val arr = new Array[Byte](r.length)
            buf.get(arr)
            arr
          }.toFox
        case SuffixLength(length) =>
          tryo {
            val channel = Files.newByteChannel(path)
            val buf = ByteBuffer.allocateDirect(length)
            channel.position(channel.size() - length)
            channel.read(buf)
            buf.rewind()
            val arr = new Array[Byte](length)
            buf.get(arr)
            arr
          }.toFox
      }
    } else Fox.empty

  override def hashCode(): Int =
    new HashCodeBuilder(19, 31).toHashCode

  override def equals(obj: Any): Boolean = true
}

object FileSystemDataVault {
  def create: FileSystemDataVault = new FileSystemDataVault
}
