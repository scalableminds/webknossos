package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox
import net.liftweb.common.Box.tryo
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.nio.ByteBuffer
import java.nio.file.{Files, Path, Paths}
import java.util.stream.Collectors
import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters._

class FileSystemDataVault extends DataVault {

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] =
    for {
      localPath <- vaultPathToLocalPath(path)
      bytes <- readBytesLocal(localPath, range)
    } yield (bytes, Encoding.identity)

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

  override def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] =
    vaultPathToLocalPath(path).map(
      localPath =>
        if (Files.isDirectory(localPath))
          Files
            .list(localPath)
            .filter(file => Files.isDirectory(file))
            .collect(Collectors.toList())
            .asScala
            .toList
            .map(dir => new VaultPath(dir.toUri, this))
            .take(maxItems)
        else List.empty)

  private def vaultPathToLocalPath(path: VaultPath)(implicit ec: ExecutionContext): Fox[Path] = {
    val uri = path.toUri
    for {
      _ <- bool2Fox(uri.getScheme == DataVaultService.schemeFile) ?~> "trying to read from FileSystemDataVault, but uri scheme is not file"
      _ <- bool2Fox(uri.getHost == null || uri.getHost.isEmpty) ?~> s"trying to read from FileSystemDataVault, but hostname ${uri.getHost} is non-empty"
      localPath = Paths.get(uri.getPath)
      _ <- bool2Fox(localPath.isAbsolute) ?~> "trying to read from FileSystemDataVault, but hostname is non-empty"
    } yield localPath
  }

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
