package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Fox, MathUtils}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.ZipEntryUPath
import com.typesafe.scalalogging.LazyLogging

import java.nio.{ByteBuffer, ByteOrder}
import java.nio.charset.StandardCharsets
import java.util.zip.ZipEntry
import scala.concurrent.ExecutionContext

case class ZipCentralDirEntry(
    localHeaderOffset: Long,
    // We allow only entries without compression (STORED) so compressedSize will equal uncompressedSize.
    // However, we still access each where it semantically makes sense, as if they could differ.
    compressedSize: Long,
    uncompressedSize: Long,
    compressionMethod: Int,
    fileName: String
) {
  def needsExtraAttributes: Boolean =
    compressedSize == 0xffffffffL || uncompressedSize == 0xffffffffL || localHeaderOffset == 0xffffffffL
}

class ZipDataVault(outerVaultPath: VaultPath) extends DataVault with LazyLogging {

  // See comments below for relevant paragraphs of zip spec https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
  private val eocdSignature: Int = 0x06054b50 // §4.3.16
  private val zip64EocdLocatorSignature: Int = 0x07064b50 // §4.3.15
  private val zip64EocdSignature: Int = 0x06064b50 // §4.3.14
  private val centralDirEntrySignature: Int = 0x02014b50 // §4.3.12
  private val eocdFixedSize: Int = 22
  private val zip64LocatorSize: Int = 20
  private val zip64EocdSize: Int = 56
  private val eocdSearchSize: Int = 65 * 1024 + 22

  // Using AlfuCache with capacity 1 instead of lazy val avoids caching failures.
  private val centralDirectoryCache: AlfuCache[Unit, Map[String, ZipCentralDirEntry]] = AlfuCache(maxCapacity = 1)

  private def getCentralDirectory(using ec: ExecutionContext, tc: TokenContext): Fox[Map[String, ZipCentralDirEntry]] =
    centralDirectoryCache.getOrLoad((), _ => readCentralDirectory)

  override def readBytesPlusEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Array[Byte], Encoding.Value, Option[String])] = for {
    normalizedInnerPath <- normalizeInnerPath(path).toFox
    centralDirectory <- getCentralDirectory
    entry <- centralDirectory.get(normalizedInnerPath).toFox
    _ <- Fox.fromBool(
      entry.compressionMethod == ZipEntry.STORED
    ) ?~> s"Only uncompressed zip entries are supported, but entry “$normalizedInnerPath” uses compression method ${entry.compressionMethod}"
    // §4.3.7: read the 30 fixed bytes of the local file header to find the variable-length offsets
    localHeaderBytes <- outerVaultPath.readBytes(
      ByteRange.startEndExclusive(entry.localHeaderOffset, entry.localHeaderOffset + 30)
    )
    localHeaderBuffer = ByteBuffer.wrap(localHeaderBytes).order(ByteOrder.LITTLE_ENDIAN)
    fileNameLength = localHeaderBuffer.getShort(26).toInt & 0xffff
    extraLength = localHeaderBuffer.getShort(28).toInt & 0xffff
    dataStart = entry.localHeaderOffset + 30L + fileNameLength + extraLength
    clampedEntryRange = clampRangeToEntry(range, entry.uncompressedSize)
    rangeInZip = ByteRange.startEndExclusive(dataStart + clampedEntryRange.start, dataStart + clampedEntryRange.end)
    (bytes, _, _) <- outerVaultPath.readBytesEncodingAndRangeHeader(rangeInZip)
    rangeHeaderInEntry = clampedEntryRange.toContentRangeHeaderWithLength(entry.uncompressedSize)
  } yield (bytes, Encoding.identity, rangeHeaderInEntry)

  override def listDirectory(path: VaultPath, maxItems: Int)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[VaultPath]] =
    for {
      normalizedInnerPath <- normalizeInnerPath(path).toFox
      dirPrefix = if (normalizedInnerPath.isEmpty) "" else normalizedInnerPath + "/"
      centralDirectory <- getCentralDirectory
      directChildren = centralDirectory.keys
        .filter(_.startsWith(dirPrefix))
        .map(_.drop(dirPrefix.length))
        .filter(remainder => remainder.nonEmpty && !remainder.dropRight(1).contains("/"))
        .take(maxItems)
      vaultPaths = directChildren.map { name =>
        new VaultPath(ZipEntryUPath(outerVaultPath.toUPath, dirPrefix + name), this)
      }.toList
    } yield vaultPaths

  override def getUsedStorageBytes(path: VaultPath)(using ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      normalizedInnerPath <- normalizeInnerPath(path).toFox
      prefix = if (normalizedInnerPath.isEmpty) "" else normalizedInnerPath + "/"
      centralDirectory <- getCentralDirectory
      total = centralDirectory.collect {
        case (name, entry) if name == normalizedInnerPath || name.startsWith(prefix) => entry.compressedSize
      }.sum
    } yield total

  private def readCentralDirectory(using ec: ExecutionContext, tc: TokenContext): Fox[Map[String, ZipCentralDirEntry]] =
    for {
      suffixBytes <- outerVaultPath.readLastBytes(eocdSearchSize)
      eocdInfo <- findEocdInfo(suffixBytes).toFox
      (cdOffset, cdSize) <- resolveCentralDirectoryBounds(eocdInfo)
      centralDirectoryBytes <- outerVaultPath.readBytes(ByteRange.startEndExclusive(cdOffset, cdOffset + cdSize))
      entries <- parseCentralDirectory(centralDirectoryBytes).toFox
    } yield entries.map(e => normalizeInnerPath(e.fileName) -> e).toMap

  // §4.3.16 (EOCD), §4.3.15 (ZIP64 locator): returns (cdOffset, cdSize), or (zip64EocdOffset, -1) if ZIP64.
  private def findEocdInfo(bytes: Array[Byte]): Box[(Long, Long)] = {
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    (bytes.length - eocdFixedSize to 0 by -1).find { pos =>
      (bytes(pos).toInt & 0xff) == (eocdSignature & 0xff) &&
      (bytes(pos + 1).toInt & 0xff) == ((eocdSignature >> 8) & 0xff) &&
      (bytes(pos + 2).toInt & 0xff) == ((eocdSignature >> 16) & 0xff) &&
      (bytes(pos + 3).toInt & 0xff) == ((eocdSignature >> 24) & 0xff)
    } match {
      case None      => Failure("Could not find End of Central Directory (EOCD) record in zip file")
      case Some(pos) =>
        val totalEntries = buffer.getShort(pos + 10).toInt & 0xffff
        val centralDirectorySize = buffer.getInt(pos + 12).toLong & 0xffffffffL
        val centralDirectoryOffset = buffer.getInt(pos + 16).toLong & 0xffffffffL
        if (totalEntries == 0xffff || centralDirectorySize == 0xffffffffL || centralDirectoryOffset == 0xffffffffL) {
          // ZIP64: find locator immediately before EOCD in this suffix buffer
          val locatorPos = pos - zip64LocatorSize
          if (locatorPos < 0)
            Failure("ZIP64 EOCD locator not found in suffix buffer (too close to file start)")
          else {
            val locatorSig = buffer.getInt(locatorPos)
            if (locatorSig != zip64EocdLocatorSignature)
              Failure(
                s"Expected ZIP64 EOCD locator signature at offset $locatorPos, got 0x${locatorSig.toHexString}"
              )
            else
              Full((buffer.getLong(locatorPos + 8), -1L))
          }
        } else
          Full((centralDirectoryOffset, centralDirectorySize))
    }
  }

  private def resolveCentralDirectoryBounds(
      eocdInfo: (Long, Long)
  )(using ec: ExecutionContext, tc: TokenContext): Fox[(Long, Long)] =
    eocdInfo match {
      case (cdOffset, cdSize) if cdSize >= 0 => Fox.successful((cdOffset, cdSize))
      case (zip64EocdAbsOffset, _)           =>
        for {
          zip64EocdBytes <- outerVaultPath.readBytes(
            ByteRange.startEndExclusive(zip64EocdAbsOffset, zip64EocdAbsOffset + zip64EocdSize)
          )
          result <- parseZip64Eocd(zip64EocdBytes).toFox
        } yield result
    }

  // §4.3.14
  private def parseZip64Eocd(bytes: Array[Byte]): Box[(Long, Long)] =
    for {
      _ <- Box.fromBool(bytes.length >= zip64EocdSize) ?~> s"ZIP64 EOCD record too short: ${bytes.length} bytes"
      buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      signature = buffer.getInt(0)
      _ <- Box.fromBool(
        signature == zip64EocdSignature
      ) ?~> s"Expected ZIP64 EOCD signature 0x${zip64EocdSignature.toHexString}, got 0x${signature.toHexString}"
      centralDirectoryOffset = buffer.getLong(48)
      centralDirectorySize = buffer.getLong(40)
    } yield (centralDirectoryOffset, centralDirectorySize)

  // §4.3.12
  private def parseCentralDirectory(centralDirectoryBytes: Array[Byte]): Box[List[ZipCentralDirEntry]] = {
    val buffer = ByteBuffer.wrap(centralDirectoryBytes).order(ByteOrder.LITTLE_ENDIAN)

    @annotation.tailrec
    def loopThroughEntriesRecursive(pos: Int, acc: List[ZipCentralDirEntry]): Box[List[ZipCentralDirEntry]] =
      if (pos > centralDirectoryBytes.length - 46) Full(acc.reverse)
      else {
        val entrySignature = buffer.getInt(pos)
        if (entrySignature != centralDirEntrySignature)
          Failure(
            s"Expected zip central directory entry signature 0x${centralDirEntrySignature.toHexString} at offset $pos, got 0x${entrySignature.toHexString}"
          )
        else {
          val compressionMethod = buffer.getShort(pos + 10).toInt & 0xffff
          val compressedSizeRaw = buffer.getInt(pos + 20).toLong & 0xffffffffL
          val uncompressedSizeRaw = buffer.getInt(pos + 24).toLong & 0xffffffffL
          val fileNameLength = buffer.getShort(pos + 28).toInt & 0xffff
          val extraLength = buffer.getShort(pos + 30).toInt & 0xffff
          val commentLength = buffer.getShort(pos + 32).toInt & 0xffff
          val localHeaderOffsetRaw = buffer.getInt(pos + 42).toLong & 0xffffffffL
          val fileName = new String(centralDirectoryBytes, pos + 46, fileNameLength, StandardCharsets.UTF_8)
          val entryRaw = ZipCentralDirEntry(
            localHeaderOffsetRaw,
            compressedSizeRaw,
            uncompressedSizeRaw,
            compressionMethod,
            fileName
          )
          val entryExtendedBox = extendEntryWithExtraFields(
            entryRaw,
            centralDirectoryBytes,
            extraStart = pos + 46 + fileNameLength,
            extraLength = extraLength
          )
          entryExtendedBox match {
            case Full(entry) =>
              loopThroughEntriesRecursive(pos + 46 + fileNameLength + extraLength + commentLength, entry :: acc)
            case f: Failure => f
            case _          => Failure("Unexpected Empty from extendEntryWithExtraFields")
          }
        }
      }

    loopThroughEntriesRecursive(0, List.empty)
  }

  // §4.5.3: ZIP64 extended information extra fields (header ID 0x0001).
  // Allowing file sizes larger than 4 GiB
  private def extendEntryWithExtraFields(
      entryRaw: ZipCentralDirEntry,
      centralDirectoryBytes: Array[Byte],
      extraStart: Int,
      extraLength: Int
  ): Box[ZipCentralDirEntry] =
    if (!entryRaw.needsExtraAttributes) Full(entryRaw)
    else {
      val buffer = ByteBuffer.wrap(centralDirectoryBytes).order(ByteOrder.LITTLE_ENDIAN)
      val end = extraStart + extraLength

      @annotation.tailrec
      def findZip64Tag(pos: Int): Option[Int] =
        if (pos + 4 > end) None
        else {
          val tag = buffer.getShort(pos).toInt & 0xffff
          val fieldSize = buffer.getShort(pos + 2).toInt & 0xffff
          if (tag == 0x0001) Some(pos + 4) else findZip64Tag(pos + 4 + fieldSize)
        }

      for {
        zip64DataStart <- Box.fromOption(
          findZip64Tag(extraStart)
        ) ?~> "ZIP64 extra field (tag 0x0001) not found in extra data field"
        needUncompressedSize = entryRaw.uncompressedSize == 0xffffffffL
        needCompressedSize = entryRaw.compressedSize == 0xffffffffL
        needLocalHeaderOffset = entryRaw.localHeaderOffset == 0xffffffffL
        uncompressedSizePos = zip64DataStart
        compressedSizePos = uncompressedSizePos + (if (needUncompressedSize) 8 else 0)
        localHeaderOffsetPos = compressedSizePos + (if (needCompressedSize) 8 else 0)
        _ <- Box.fromBool(
          !needUncompressedSize || uncompressedSizePos + 8 <= end
        ) ?~> "ZIP64 extra field truncated: missing uncompressedSize"
        _ <- Box.fromBool(
          !needCompressedSize || compressedSizePos + 8 <= end
        ) ?~> "ZIP64 extra field truncated: missing compressedSize"
        _ <- Box.fromBool(
          !needLocalHeaderOffset || localHeaderOffsetPos + 8 <= end
        ) ?~> "ZIP64 extra field truncated: missing localHeaderOffset"
        entryFilled = entryRaw.copy(
          uncompressedSize =
            if (needUncompressedSize) buffer.getLong(uncompressedSizePos) else entryRaw.uncompressedSize,
          compressedSize = if (needCompressedSize) buffer.getLong(compressedSizePos) else entryRaw.compressedSize,
          localHeaderOffset =
            if (needLocalHeaderOffset) buffer.getLong(localHeaderOffsetPos) else entryRaw.localHeaderOffset
        )
      } yield entryFilled
    }

  private def normalizeInnerPath(vaultPath: VaultPath): Box[String] =
    for {
      zipEntryUPath <- vaultPath.toUPath.toZipEntryUPath ?~> "ZipDataVault received path with non-ZipEntryUPath"
      normalizedInnerPath = normalizeInnerPath(zipEntryUPath.innerPath)
    } yield normalizedInnerPath

  private def normalizeInnerPath(name: String): String =
    name.stripPrefix("/").stripSuffix("/")

  private def clampRangeToEntry(range: ByteRange, entrySize: Long): StartEndExclusiveByteRange = {
    val (start, end) = range match {
      case CompleteByteRange()              => (0L, entrySize)
      case StartEndExclusiveByteRange(s, e) => (s, e)
      case SuffixLengthByteRange(n)         => (entrySize - n, entrySize)
    }
    StartEndExclusiveByteRange(MathUtils.clamp(start, 0L, entrySize), MathUtils.clamp(end, 0L, entrySize))
  }

}
