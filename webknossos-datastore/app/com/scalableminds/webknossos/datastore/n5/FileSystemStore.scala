package com.scalableminds.webknossos.datastore.n5

import java.io.{DataInputStream, FileInputStream}
import java.nio.file.{Files, Path}

class FileSystemStore(val internalRoot: Path) {
  def readBytes(key: String): Option[Array[Byte]] = {
    val path = internalRoot.resolve(key)
    tryo(Files.readAllBytes(path)).toOption
  }

  val in = new FileInputStream("path")
  val dis = new DataInputStream(in)
  val mode: Short = dis.readShort
  var numElements = 0
  if (mode != 2) {
    val nDim = dis.readShort
    val blockSize = new Array[Int](nDim)
    for (d <- 0 until nDim) {
      blockSize(d) = dis.readInt
    }
    if (mode == 0) numElements = DataBlock.getNumElements(blockSize)
    else numElements = dis.readInt
    dataBlock = datasetAttributes.getDataType.createDataBlock(blockSize, gridPosition, numElements)
  }
  else {
    numElements = dis.readInt
    dataBlock = datasetAttributes.getDataType.createDataBlock(null, gridPosition, numElements)
  }
}
