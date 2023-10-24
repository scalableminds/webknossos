package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import net.liftweb.util.Helpers.tryo
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.nio.ByteBuffer
import java.nio.file.{Files, Path, Paths}
import scala.concurrent.ExecutionContext

class FileSystemDataVault extends DataVault {

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = {
    val uri = path.toUri
    for {
      _ <- bool2Fox(uri.getScheme == DataVaultService.schemeFile) ?~> "trying to read from FileSystemDataVault, but uri scheme is not file"
      _ <- bool2Fox(uri.getHost == null || uri.getHost.isEmpty) ?~> s"trying to read from FileSystemDataVault, but hostname ${uri.getHost} is non-empty"
      localPath = Paths.get(uri.getPath)
      _ <- bool2Fox(localPath.isAbsolute) ?~> "trying to read from FileSystemDataVault, but hostname is non-empty"
      bytes <- readBytesLocal(localPath, range)
    } yield (bytes, Encoding.identity)
  }

  private def readBytesLocal(localPath: Path, range: RangeSpecifier)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    if (Files.exists(localPath)) {
      range match {
        case Complete() => tryo(Files.readAllBytes(localPath)).toFox
        case StartEnd(r) =>
          tryo {
            val channel = Files.newByteChannel(localPath)
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
            val channel = Files.newByteChannel(localPath)
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

  override def equals(obj: Any): Boolean = obj match {
    case _: FileSystemDataVault => true
    case _                      => false
  }

}

object FileSystemDataVault {
  def create: FileSystemDataVault = new FileSystemDataVault
}
