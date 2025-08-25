package com.scalableminds.webknossos.datastore.datavault

import com.aayushatharva.brotli4j.Brotli4jLoader
import com.aayushatharva.brotli4j.decoder.BrotliInputStream
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.helpers.UPath
import org.apache.commons.lang3.builder.HashCodeBuilder
import play.api.libs.json.Reads

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import java.net.URI
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class VaultPath(upath: UPath, dataVault: DataVault) extends LazyLogging with FoxImplicits {

  def readBytes(range: Option[NumericRange[Long]] = None)(implicit ec: ExecutionContext,
                                                          tc: TokenContext): Fox[Array[Byte]] =
    for {
      bytesAndEncoding <- dataVault.readBytesAndEncoding(this, RangeSpecifier.fromRangeOpt(range)) ?=> "Failed to read from vault path"
      decoded <- decode(bytesAndEncoding) ?~> s"Failed to decode ${bytesAndEncoding._2}-encoded response."
    } yield decoded

  def readLastBytes(byteCount: Int)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      bytesAndEncoding <- dataVault.readBytesAndEncoding(this, SuffixLength(byteCount)) ?=> "Failed to read from vault path"
      decoded <- decode(bytesAndEncoding) ?~> s"Failed to decode ${bytesAndEncoding._2}-encoded response."
    } yield decoded

  private def decode(bytesAndEncoding: (Array[Byte], Encoding.Value))(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    bytesAndEncoding match {
      case (bytes, encoding) =>
        encoding match {
          case Encoding.gzip       => tryo(ZipIO.gunzip(bytes)).toFox
          case Encoding.brotli     => tryo(decodeBrotli(bytes)).toFox
          case Encoding.`identity` => Fox.successful(bytes)
        }
    }

  def listDirectory(maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] =
    dataVault.listDirectory(this, maxItems)

  private def decodeBrotli(bytes: Array[Byte]) = {
    Brotli4jLoader.ensureAvailability()
    val brotliInputStream = new BrotliInputStream(new ByteArrayInputStream(bytes))
    val out = new ByteArrayOutputStream
    var read = brotliInputStream.read
    try {
      while (read > -1) {
        out.write(read)
        read = brotliInputStream.read
      }
    } catch {
      case _: IOException =>
    }
    out.toByteArray
  }

  def basename: String =
    upath.basename

  def parent: VaultPath =
    new VaultPath(upath.parent, dataVault)

  def /(key: String): VaultPath =
    new VaultPath(upath / key, dataVault)

  def toRemoteUriUnsafe: URI =
    upath.toRemoteUriUnsafe

  def toUPath: UPath = upath

  override def toString: String = upath.toString

  def summary: String = s"VaultPath: ${this.toString} for ${dataVault.getClass.getSimpleName}"

  private def getDataVault: DataVault = dataVault

  // TODO re-test
  override def equals(obj: Any): Boolean = obj match {
    case other: VaultPath => other.toUPath == toUPath && other.getDataVault == dataVault
    case _                => false
  }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(upath.toString).append(dataVault).toHashCode

  def parseAsJson[T: Reads](implicit ec: ExecutionContext, tc: TokenContext): Fox[T] =
    for {
      fileBytes <- this.readBytes()
      parsed <- JsonHelper.parseAs[T](fileBytes).toFox
    } yield parsed
}
