package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.helpers.UPath
import org.apache.commons.io.FileUtils
import org.apache.commons.lang3.builder.HashCodeBuilder

import java.nio.ByteBuffer
import java.nio.channels.{AsynchronousFileChannel, CompletionHandler}
import java.nio.file.{Files, Path, StandardOpenOption}
import java.util.stream.Collectors
import scala.concurrent.{ExecutionContext, Promise}
import scala.jdk.CollectionConverters._

class FileSystemDataVault extends DataVault with FoxImplicits {

  override def readBytesAndEncoding(path: VaultPath, range: ByteRange)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Encoding.Value)] =
    for {
      localPath <- vaultPathToLocalPath(path)
      bytes <- readBytesLocal(localPath, range)
    } yield (bytes, Encoding.identity)

  private def readBytesLocal(localPath: Path, range: ByteRange)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    if (Files.exists(localPath)) {
      range match {
        case CompleteByteRange() =>
          readAsync(localPath, 0, Math.toIntExact(Files.size(localPath)))

        case r: StartEndExclusiveByteRange =>
          readAsync(localPath, r.start, r.length)

        case SuffixLengthByteRange(length) =>
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

    for {
      box <- Fox.fromFuture(promise.future)
      result <- box.toFox
    } yield result
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
          .map(dir => new VaultPath(UPath.fromLocalPath(dir), this))
          .take(maxItems)
      } else List.empty
    } yield listing

  override def getUsedStorageBytes(path: VaultPath)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      localPath <- vaultPathToLocalPath(path)
      usedStorageBytes <- tryo(FileUtils.sizeOfAsBigInteger(localPath.toFile).longValue).toFox ?~> "Failed to get used storage bytes"
    } yield usedStorageBytes

  private def vaultPathToLocalPath(path: VaultPath)(implicit ec: ExecutionContext): Fox[Path] =
    for {
      localPath <- path.toUPath.toLocalPath.toFox ?~> s"trying to read from FileSystemDataVault, but path $path is not local."
      _ <- Fox.fromBool(localPath.isAbsolute) ?~> s"trying to read from FileSystemDataVault, but path $path is not absolute."
    } yield localPath

  // There is only one instance of this DataVault, so the hashCode does not depend on any values.
  private lazy val hashCodeCached = new HashCodeBuilder(19, 31).toHashCode

  override def hashCode(): Int = hashCodeCached

  override def equals(obj: Any): Boolean = obj match {
    case _: FileSystemDataVault => true
    case _                      => false
  }

}

object FileSystemDataVault {
  def create: FileSystemDataVault = new FileSystemDataVault
}
