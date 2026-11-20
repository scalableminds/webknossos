package com.scalableminds.webknossos.datastore.compresso

import com.scalableminds.webknossos.datastore.helpers.NativeLibrary

class NativeCompressoCompressor {
  NativeLibrary.ensureLoaded()

  @native def decompress(bytes: Array[Byte], maxOutputLength: Int): Array[Byte]
}
