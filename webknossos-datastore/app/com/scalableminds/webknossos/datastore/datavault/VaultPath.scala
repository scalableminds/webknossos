package com.scalableminds.webknossos.datastore.datavault

import com.aayushatharva.brotli4j.Brotli4jLoader
import com.aayushatharva.brotli4j.decoder.BrotliInputStream
import com.scalableminds.util.io.ZipIO
import net.liftweb.util.Helpers.tryo

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, IOException}
import java.net.URI
import scala.collection.immutable.NumericRange

class VaultPath(uri: URI, dataVault: DataVault) {

  def readBytes(range: Option[NumericRange[Long]] = None): Option[Array[Byte]] = {
    val resultOpt = tryo(dataVault.readBytes(this, range)).toOption
    resultOpt match {
      case Some((bytes, encoding)) =>
        encoding match {
          case Encoding.gzip   => Some(ZipIO.tryGunzip(bytes))
          case Encoding.brotli => tryo(decodeBrotli(bytes)).toOption
          case Encoding.`identity`   => Some(bytes)
          case Encoding.unsupported =>
            throw new UnsupportedOperationException("Vault uses unsupported content encoding.")
        }
      case None => None

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
