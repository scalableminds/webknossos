package com.scalableminds.webknossos.datastore.datavault

import com.aayushatharva.brotli4j.Brotli4jLoader
import com.aayushatharva.brotli4j.decoder.BrotliInputStream
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{Fox, JsonHelper, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import org.apache.commons.lang3.builder.HashCodeBuilder
import play.api.libs.json.Reads

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import java.net.URI
import java.nio.charset.StandardCharsets
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class VaultPath(uri: URI, dataVault: DataVault) extends LazyLogging with FoxImplicits {

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
    uri.toString.split("/").last

  def parent: VaultPath = {
    val newUri =
      if (uri.getPath.endsWith("/")) uri.resolve("..")
      else uri.resolve(".")
    new VaultPath(newUri, dataVault)
  }

  def /(key: String): VaultPath =
    if (uri.toString.endsWith("/")) {
      new VaultPath(uri.resolve(key), dataVault)
    } else {
      new VaultPath(new URI(s"${uri.toString}/").resolve(key), dataVault)
    }

  def toUri: URI =
    uri

  override def toString: String = uri.toString

  def summary: String = s"VaultPath: ${this.toString} for ${dataVault.getClass.getSimpleName}"

  private def getDataVault: DataVault = dataVault

  override def equals(obj: Any): Boolean = obj match {
    case other: VaultPath => other.toUri == toUri && other.getDataVault == dataVault
    case _                => false
  }

  override def hashCode(): Int =
    new HashCodeBuilder(17, 31).append(uri.toString).append(dataVault).toHashCode

  def parseAsJson[T: Reads](implicit ec: ExecutionContext, tc: TokenContext): Fox[T] =
    for {
      fileBytes <- this.readBytes()
      fileAsString <- tryo(new String(fileBytes, StandardCharsets.UTF_8)).toFox
      parsed <- JsonHelper.parseAndValidateJson[T](fileAsString).toFox
    } yield parsed
}
