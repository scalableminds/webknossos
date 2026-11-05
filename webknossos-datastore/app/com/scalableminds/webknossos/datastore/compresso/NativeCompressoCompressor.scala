package com.scalableminds.webknossos.datastore.compresso

import com.scalableminds.webknossos.datastore.helpers.NativeLibraries

class NativeCompressoCompressor {
  NativeLibraries.ensureLoaded()

  @native def decompress(bytes: Array[Byte], maxOutputLength: Int): Array[Byte]
}
