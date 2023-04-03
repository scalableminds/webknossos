package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.io.ZipIO
import net.liftweb.util.Helpers.tryo

import java.net.URI
import scala.collection.immutable.NumericRange

class VaultPath(uri: URI, dataVault: DataVault) {

  def readBytes(range: Option[NumericRange[Long]] = None): Option[Array[Byte]] =
    tryo(dataVault.readBytes(this, range)).toOption.map(ZipIO.tryGunzip)

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
