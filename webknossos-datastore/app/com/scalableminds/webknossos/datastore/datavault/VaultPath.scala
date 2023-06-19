package com.scalableminds.webknossos.datastore.datavault

import com.aayushatharva.brotli4j.Brotli4jLoader
import com.aayushatharva.brotli4j.decoder.BrotliInputStream
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.box2Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.util.Helpers.tryo

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import java.net.URI
import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext

class VaultPath(uri: URI, dataVault: DataVault) extends LazyLogging {

  def readBytes(range: Option[NumericRange[Long]] = None)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      bytesAndEncoding <- dataVault.readBytesAndEncoding(this, RangeSpecifier.fromRangeOpt(range)) ?=> "Failed to read from vault path"
      decoded <- decode(bytesAndEncoding) ?~> s"Failed to decode ${bytesAndEncoding._2}-encoded response."
    } yield decoded

  def readLastBytes(byteCount: Long)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      bytesAndEncoding <- dataVault.readBytesAndEncoding(this, SuffixLength(byteCount)) ?=> "Failed to read from vault path"
      decoded <- decode(bytesAndEncoding) ?~> s"Failed to decode ${bytesAndEncoding._2}-encoded response."
    } yield decoded

  private def decode(bytesAndEncoding: (Array[Byte], Encoding.Value))(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    bytesAndEncoding match {
      case (bytes, encoding) =>
        encoding match {
          case Encoding.gzip       => tryo(ZipIO.gunzip(bytes))
          case Encoding.brotli     => tryo(decodeBrotli(bytes))
          case Encoding.`identity` => Fox.successful(bytes)
        }
    }

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
}
