package com.scalableminds.webknossos.datastore.datareaders.n5

import com.google.common.io.{ByteArrayDataInput, ByteStreams}
import com.scalableminds.webknossos.datastore.datareaders.FileSystemStore
import net.liftweb.util.Helpers.tryo
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, DataInputStream, FileInputStream, InputStream}
import java.nio.ByteBuffer
import java.nio.file.{Files, Path}

class FileSystemStoreN5(override val internalRoot: Path) extends FileSystemStore(internalRoot) {
  override def readBytes(key: String): Option[Array[Byte]] =
    readBytesAndHeader(key)._2

  def readBytesAndHeader(key: String): (N5BlockHeader, Option[Array[Byte]]) = {
    val data: Array[Byte] = readBytesFromFile(key).getOrElse(Array(0))
    val in = new ByteArrayInputStream(data)
    val dis = new DataInputStream(in)

    val header = extractHeader(dis)
    val buffer = extractData(in)

    (header, Some(buffer))
  }

  def readBytesFromFile(key: String): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    tryo(Files.readAllBytes(path)).toOption
  }

  private def extractData(in: InputStream): Array[Byte] = {
    val os = new ByteArrayOutputStream()
    val bytes = new Array[Byte](4096)
    var read = in.read(bytes)
    while ({
      read >= 0
    }) {
      if (read > 0) {
        os.write(bytes, 0, read)
      }
      read = in.read(bytes)
    }
    os.toByteArray
  }

  private def extractHeader(dis: DataInputStream): N5BlockHeader = {
    val mode: Short = dis.readShort
    var numElements = 0

    // default or varlength mode
    if (mode != 2) {
      // number of dimensions
      val nDim = dis.readShort
      // dimension sizes
      val blockSize = new Array[Int](nDim)
      for (d <- 0 until nDim) {
        blockSize(d) = dis.readInt
      }
      // default mode
      // TODO doesnt take into consideration element type
      if (mode == 0) numElements = blockSize.product
      // varlength mode (end of block)
      else numElements = dis.readInt
      N5BlockHeader(blockSize, numElements)
    } else {
      // else case not in specification
      numElements = dis.readInt
      N5BlockHeader(new Array[Int](0), numElements)
    }
  }
}
