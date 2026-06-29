package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Box, Failure, Fox, Full}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.ZipEntryUPath
import com.typesafe.scalalogging.LazyLogging

import java.nio.{ByteBuffer, ByteOrder}
import java.nio.charset.StandardCharsets
import scala.concurrent.ExecutionContext

private case class ZipCentralDirEntry(
    localHeaderOffset: Long,
    compressedSize: Long,
    uncompressedSize: Long,
    compressionMethod: Int,
    fileName: String
)

class ZipDataVault(outerVaultPath: VaultPath) extends DataVault with LazyLogging {

  // Two concurrent first-reads are safe: the operation is idempotent and the volatile
  // write ensures the result is visible once the winner completes.
  @volatile private var _centralDir: Option[Map[String, ZipCentralDirEntry]] = None

  private def getCentralDirectory(using ec: ExecutionContext, tc: TokenContext): Fox[Map[String, ZipCentralDirEntry]] =
    _centralDir match {
      case Some(cd) => Fox.successful(cd)
      case None =>
        for {
          cd <- readCentralDirectory()
          _ = _centralDir = Some(cd)
        } yield cd
    }

  private def readCentralDirectory()(using ec: ExecutionContext,
                                     tc: TokenContext): Fox[Map[String, ZipCentralDirEntry]] =
    for {
      suffixBytes <- outerVaultPath.readLastBytes(ZipDataVault.eocdSearchSize)
      eocdInfo <- findEocd(suffixBytes).toFox
      (cdOffset, cdSize) <- resolveCdBounds(eocdInfo)
      cdBytes <- outerVaultPath.readBytes(ByteRange.startEndExclusive(cdOffset, cdOffset + cdSize))
      entries <- parseCentralDirectory(cdBytes).toFox
    } yield entries.map(e => normalizeInnerPath(e.fileName) -> e).toMap

  // Returns (cdOffset, cdSize) for a standard EOCD, or (zip64EocdOffset, -1)
  // to signal a ZIP64 EOCD must be read at that absolute file offset.
  private def findEocd(buf: Array[Byte]): Box[(Long, Long)] = {
    val sigBytes = ZipDataVault.eocdSignature
    var pos = buf.length - ZipDataVault.eocdFixedSize
    while (pos >= 0) {
      if ((buf(pos).toInt & 0xff) == (sigBytes & 0xff) &&
          (buf(pos + 1).toInt & 0xff) == ((sigBytes >> 8) & 0xff) &&
          (buf(pos + 2).toInt & 0xff) == ((sigBytes >> 16) & 0xff) &&
          (buf(pos + 3).toInt & 0xff) == ((sigBytes >> 24) & 0xff)) {
        val bb = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
        val totalEntries = bb.getShort(pos + 10).toInt & 0xffff
        val cdSize = bb.getInt(pos + 12).toLong & 0xffffffffL
        val cdOffset = bb.getInt(pos + 16).toLong & 0xffffffffL
        if (totalEntries == 0xffff || cdSize == 0xffffffffL || cdOffset == 0xffffffffL) {
          // ZIP64: find locator immediately before EOCD in this suffix buffer
          val locatorPos = pos - ZipDataVault.zip64LocatorSize
          if (locatorPos < 0)
            return Failure("ZIP64 EOCD locator not found in suffix buffer (too close to file start)")
          val locatorSig = bb.getInt(locatorPos)
          if (locatorSig != ZipDataVault.zip64EocdLocatorSignature)
            return Failure(
              s"Expected ZIP64 EOCD locator signature at offset $locatorPos, got 0x${locatorSig.toHexString}")
          val zip64EocdAbsOffset = bb.getLong(locatorPos + 8)
          return Full((zip64EocdAbsOffset, -1L))
        }
        return Full((cdOffset, cdSize))
      }
      pos -= 1
    }
    Failure("Could not find End of Central Directory (EOCD) record in zip file")
  }

  private def resolveCdBounds(eocdInfo: (Long, Long))(using ec: ExecutionContext,
                                                        tc: TokenContext): Fox[(Long, Long)] =
    eocdInfo match {
      case (cdOffset, cdSize) if cdSize >= 0 => Fox.successful((cdOffset, cdSize))
      case (zip64EocdAbsOffset, _) =>
        for {
          zip64EocdBytes <- outerVaultPath.readBytes(
            ByteRange.startEndExclusive(zip64EocdAbsOffset, zip64EocdAbsOffset + ZipDataVault.zip64EocdSize))
          result <- parseZip64Eocd(zip64EocdBytes).toFox
        } yield result
    }

  private def parseZip64Eocd(bytes: Array[Byte]): Box[(Long, Long)] = {
    if (bytes.length < ZipDataVault.zip64EocdSize)
      return Failure(s"ZIP64 EOCD record too short: ${bytes.length} bytes")
    val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val sig = bb.getInt(0)
    if (sig != ZipDataVault.zip64EocdSignature)
      return Failure(
        s"Expected ZIP64 EOCD signature 0x${ZipDataVault.zip64EocdSignature.toHexString}, got 0x${sig.toHexString}")
    Full((bb.getLong(48), bb.getLong(40))) // (cdOffset, cdSize)
  }

  private def parseCentralDirectory(cdBytes: Array[Byte]): Box[List[ZipCentralDirEntry]] = {
    val bb = ByteBuffer.wrap(cdBytes).order(ByteOrder.LITTLE_ENDIAN)
    val entries = scala.collection.mutable.ListBuffer[ZipCentralDirEntry]()
    var pos = 0
    while (pos <= cdBytes.length - 46) {
      val sig = bb.getInt(pos)
      if (sig != ZipDataVault.centralDirEntrySignature)
        return Failure(
          s"Expected central directory entry signature 0x${ZipDataVault.centralDirEntrySignature.toHexString} at offset $pos, got 0x${sig.toHexString}")
      val compressionMethod = bb.getShort(pos + 10).toInt & 0xffff
      var compressedSize = bb.getInt(pos + 20).toLong & 0xffffffffL
      var uncompressedSize = bb.getInt(pos + 24).toLong & 0xffffffffL
      val fileNameLen = bb.getShort(pos + 28).toInt & 0xffff
      val extraLen = bb.getShort(pos + 30).toInt & 0xffff
      val commentLen = bb.getShort(pos + 32).toInt & 0xffff
      var localHeaderOffset = bb.getInt(pos + 42).toLong & 0xffffffffL
      val fileName = new String(cdBytes, pos + 46, fileNameLen, StandardCharsets.UTF_8)
      if (compressedSize == 0xffffffffL || uncompressedSize == 0xffffffffL || localHeaderOffset == 0xffffffffL) {
        parseZip64ExtraInCd(
          cdBytes,
          extraStart = pos + 46 + fileNameLen,
          extraLen = extraLen,
          needUncompressedSize = uncompressedSize == 0xffffffffL,
          needCompressedSize = compressedSize == 0xffffffffL,
          needLocalHeaderOffset = localHeaderOffset == 0xffffffffL
        ) match {
          case Full((cs, us, lho)) =>
            if (compressedSize == 0xffffffffL) compressedSize = cs
            if (uncompressedSize == 0xffffffffL) uncompressedSize = us
            if (localHeaderOffset == 0xffffffffL) localHeaderOffset = lho
          case f: Failure => return f
          case _          => return Failure("Unexpected Empty from parseZip64ExtraInCd")
        }
      }
      entries += ZipCentralDirEntry(localHeaderOffset, compressedSize, uncompressedSize, compressionMethod, fileName)
      pos += 46 + fileNameLen + extraLen + commentLen
    }
    Full(entries.toList)
  }

  // Returns (compressedSize, uncompressedSize, localHeaderOffset) from the ZIP64 extra field.
  // Fields not needed are returned as -1.
  // Per spec, fields appear in this order (only if the corresponding CD field was 0xFFFFFFFF):
  //   uncompressedSize (8), compressedSize (8), localHeaderOffset (8), diskNumber (4)
  private def parseZip64ExtraInCd(cdBytes: Array[Byte],
                                   extraStart: Int,
                                   extraLen: Int,
                                   needUncompressedSize: Boolean,
                                   needCompressedSize: Boolean,
                                   needLocalHeaderOffset: Boolean): Box[(Long, Long, Long)] = {
    val bb = ByteBuffer.wrap(cdBytes).order(ByteOrder.LITTLE_ENDIAN)
    var pos = extraStart
    val end = extraStart + extraLen
    while (pos + 4 <= end) {
      val tag = bb.getShort(pos).toInt & 0xffff
      val fieldSize = bb.getShort(pos + 2).toInt & 0xffff
      if (tag == 0x0001) {
        var fieldPos = pos + 4
        var uncompressedSize = -1L
        var compressedSize = -1L
        var localHeaderOffset = -1L
        if (needUncompressedSize && fieldPos + 8 <= end) {
          uncompressedSize = bb.getLong(fieldPos); fieldPos += 8
        }
        if (needCompressedSize && fieldPos + 8 <= end) {
          compressedSize = bb.getLong(fieldPos); fieldPos += 8
        }
        if (needLocalHeaderOffset && fieldPos + 8 <= end) {
          localHeaderOffset = bb.getLong(fieldPos)
        }
        return Full((compressedSize, uncompressedSize, localHeaderOffset))
      }
      pos += 4 + fieldSize
    }
    Failure(s"ZIP64 extra field (tag 0x0001) not found in extra data of length $extraLen")
  }

  private def normalizeInnerPath(name: String): String =
    name.stripPrefix("/").stripSuffix("/")

  override def readBytesEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(using
      ec: ExecutionContext,
      tc: TokenContext): Fox[(Array[Byte], Encoding.Value, Option[String])] =
    path.toUPath match {
      case ZipEntryUPath(_, innerPath) =>
        val normalizedPath = normalizeInnerPath(innerPath)
        for {
          cd <- getCentralDirectory
          entry <- cd.get(normalizedPath) match {
            case Some(e) => Fox.successful(e)
            case None    => Fox.empty
          }
          _ <- if (entry.compressionMethod == 0) Fox.successful(())
               else Fox.failure(s"Only STORED (uncompressed) zip entries are supported, but entry '$normalizedPath' uses compression method ${entry.compressionMethod}")
          // Read the 30 fixed bytes of the local file header to find the variable-length offsets
          localHeaderBytes <- outerVaultPath.readBytes(
            ByteRange.startEndExclusive(entry.localHeaderOffset, entry.localHeaderOffset + 30))
          localHeaderBb = ByteBuffer.wrap(localHeaderBytes).order(ByteOrder.LITTLE_ENDIAN)
          fileNameLen = localHeaderBb.getShort(26).toInt & 0xffff
          extraLen = localHeaderBb.getShort(28).toInt & 0xffff
          dataStart = entry.localHeaderOffset + 30L + fileNameLen + extraLen
          finalRange = toAbsoluteRange(dataStart, entry.compressedSize, range)
          (bytes, _, rangeHeader) <- outerVaultPath.readBytesEncodingAndRangeHeader(finalRange)
        } yield (bytes, Encoding.identity, rangeHeader)
      case other =>
        Fox.failure(s"ZipDataVault received path with non-ZipEntryUPath: ${other.getClass.getSimpleName}")
    }

  private def toAbsoluteRange(dataStart: Long, entrySize: Long, range: ByteRange): ByteRange =
    range match {
      case CompleteByteRange() =>
        ByteRange.startEndExclusive(dataStart, dataStart + entrySize)
      case StartEndExclusiveByteRange(s, e) =>
        ByteRange.startEndExclusive(dataStart + s, dataStart + e)
      case SuffixLengthByteRange(n) =>
        ByteRange.startEndExclusive(dataStart + entrySize - n, dataStart + entrySize)
    }

  override def listDirectory(path: VaultPath, maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] = {
    implicit val tc: TokenContext = TokenContext(None)
    val dirPrefix = path.toUPath match {
      case ZipEntryUPath(_, ip) => normalizeInnerPath(ip) + "/"
      case _                    => ""
    }
    for {
      cd <- getCentralDirectory
      directChildren = cd.keys
        .filter(_.startsWith(dirPrefix))
        .map(_.drop(dirPrefix.length))
        .filter(remainder => remainder.nonEmpty && !remainder.dropRight(1).contains("/"))
        .take(maxItems)
        .toList
      vaultPaths = directChildren.map { name =>
        new VaultPath(ZipEntryUPath(outerVaultPath.toUPath, dirPrefix + name), this)
      }
    } yield vaultPaths
  }

  override def getUsedStorageBytes(path: VaultPath)(using ec: ExecutionContext, tc: TokenContext): Fox[Long] = {
    val prefix = path.toUPath match {
      case ZipEntryUPath(_, ip) => normalizeInnerPath(ip) + "/"
      case _                    => ""
    }
    for {
      cd <- getCentralDirectory
      total = cd.values.filter(e => normalizeInnerPath(e.fileName).startsWith(prefix)).map(_.compressedSize).sum
    } yield total
  }
}

object ZipDataVault {
  private[datavault] val eocdSignature: Int = 0x06054b50
  private[datavault] val zip64EocdLocatorSignature: Int = 0x07064b50
  private[datavault] val zip64EocdSignature: Int = 0x06064b50
  private[datavault] val centralDirEntrySignature: Int = 0x02014b50
  private[datavault] val eocdFixedSize: Int = 22
  private[datavault] val zip64LocatorSize: Int = 20
  private[datavault] val zip64EocdSize: Int = 56
  val eocdSearchSize: Int = 65 * 1024 + 22
}
