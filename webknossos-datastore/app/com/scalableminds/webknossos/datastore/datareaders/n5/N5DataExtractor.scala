package com.scalableminds.webknossos.datastore.datareaders.n5

import java.io.{ByteArrayInputStream, ByteArrayOutputStream, DataInputStream, InputStream}

class N5DataExtractor {
  def readBytesAndHeader(data: Array[Byte]): (N5BlockHeader, Option[Array[Byte]]) = {
    val in = new ByteArrayInputStream(data)
    val dis = new DataInputStream(in)

    val header = extractHeader(dis)
    val buffer = extractData(in)

    (header, Some(buffer))
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

  private def extractHeader(inputStream: DataInputStream): N5BlockHeader = {
    // default or varlength mode
    val mode: Short = inputStream.readShort
    var numElements = 0

    if (mode != 2) {
      val dimensionCount = inputStream.readShort // number of dimensions
      // block sizes
      val blockSize = new Array[Int](dimensionCount)
      for (d <- 0 until dimensionCount) {
        blockSize(d) = inputStream.readInt
      }
      if (mode == 0) numElements = blockSize.product // default mode
      else numElements = inputStream.readInt // varlength mode (end of block)
      N5BlockHeader(blockSize, numElements)
    } else {
      // else case not in specification
      numElements = inputStream.readInt
      N5BlockHeader(new Array[Int](0), numElements)
    }
  }
}
