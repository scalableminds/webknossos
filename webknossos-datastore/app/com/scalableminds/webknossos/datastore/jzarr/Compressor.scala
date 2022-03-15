package com.scalableminds.webknossos.datastore.jzarr

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

abstract class Compressor {

  def getId: String

  def toString: String

  @throws[IOException]
  def compress(is: InputStream, os: OutputStream)

  @throws[IOException]
  def uncompress(is: InputStream, os: OutputStream)

  @throws[IOException]
  def passThrough(is: InputStream, os: OutputStream): Unit = {
    val bytes = new Array[Byte](4096)
    var read = is.read(bytes)
    while ({ read >= 0 }) {
      if (read > 0)
        os.write(bytes, 0, read)
      read = is.read(bytes)
    }
  }

}
