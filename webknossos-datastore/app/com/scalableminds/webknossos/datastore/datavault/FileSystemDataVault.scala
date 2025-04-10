package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import net.liftweb.common.{Box, Full}
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.nio.ByteBuffer
import java.nio.channels.{AsynchronousFileChannel, CompletionHandler}
import java.nio.file.{Files, Path, Paths, StandardOpenOption}
import java.util.stream.Collectors
import scala.concurrent.{ExecutionContext, Promise}
import scala.jdk.CollectionConverters._

class FileSystemDataVault extends DataVault {

  override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Encoding.Value)] =
    for {
      localPath <- vaultPathToLocalPath(path)
      bytes <- readBytesLocal(localPath, range)
    } yield (bytes, Encoding.identity)

  private def readBytesLocal(localPath: Path, range: RangeSpecifier)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    if (Files.exists(localPath)) {
      range match {
        case Complete() =>
          readAsync(localPath, 0, Math.toIntExact(Files.size(localPath)))

        case StartEnd(r) =>
          readAsync(localPath, r.start, r.length)

        case SuffixLength(length) =>
          val fileSize = Files.size(localPath)
          readAsync(localPath, fileSize - length, length)
      }
    } else {
      Fox.empty
    }

  private def readAsync(path: Path, position: Long, length: Int)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val promise = Promise[Box[Array[Byte]]]()
    val buffer = ByteBuffer.allocateDirect(length)
    var channel: AsynchronousFileChannel = null

    try {
      channel = AsynchronousFileChannel.open(path, StandardOpenOption.READ)

      channel.read(
        buffer,
        position,
        buffer,
        new CompletionHandler[Integer, ByteBuffer] {
          override def completed(result: Integer, buffer: ByteBuffer): Unit = {
            buffer.rewind()
            val arr = new Array[Byte](length)
            buffer.get(arr)
            promise.success(Full(arr))
            channel.close()
          }

          override def failed(exc: Throwable, buffer: ByteBuffer): Unit = {
            promise.failure(exc)
            channel.close()
          }
        }
      )
    } catch {
      case e: Throwable =>
        promise.failure(e)
        if (channel != null && channel.isOpen) channel.close()
    }

    Fox.futureBox2Fox(promise.future)
  }

  override def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] =
    for {
      localPath <- vaultPathToLocalPath(path)
      listing = if (Files.isDirectory(localPath)) {
        Files
          .list(localPath)
          .filter(file => Files.isDirectory(file))
          .collect(Collectors.toList())
          .asScala
          .toList
          .map(dir => new VaultPath(dir.toUri, this))
          .take(maxItems)
      } else List.empty
    } yield listing

  private def vaultPathToLocalPath(path: VaultPath)(implicit ec: ExecutionContext): Fox[Path] = {
    val uri = path.toUri
    for {
      _ <- Fox.fromBool(uri.getScheme == DataVaultService.schemeFile) ?~> "trying to read from FileSystemDataVault, but uri scheme is not file"
      _ <- Fox.fromBool(uri.getHost == null || uri.getHost.isEmpty) ?~> s"trying to read from FileSystemDataVault, but hostname ${uri.getHost} is non-empty"
      localPath = Paths.get(uri.getPath)
      _ <- Fox.fromBool(localPath.isAbsolute) ?~> "trying to read from FileSystemDataVault, but hostname is non-empty"
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
