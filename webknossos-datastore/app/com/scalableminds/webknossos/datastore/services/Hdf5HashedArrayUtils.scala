package com.scalableminds.webknossos.datastore.services

import org.apache.commons.codec.digest.MurmurHash3

import java.nio.ByteBuffer

trait Hdf5HashedArrayUtils {

  val hdf5FileExtension = "hdf5"

  def getHashFunction(name: String): Long => Long = name match {
    case "identity" => identity
    case "murmurhash3_x64_128" =>
      (x: Long) => Math.abs(MurmurHash3.hash128x64(ByteBuffer.allocate(8).putLong(x).array())(1))
  }
}
