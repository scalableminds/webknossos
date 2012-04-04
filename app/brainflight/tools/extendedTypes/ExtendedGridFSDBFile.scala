package brainflight.tools.extendedTypes

import com.mongodb.casbah.gridfs.Imports._

class ExtendedGridFSDBFile(f: GridFSDBFile){
  /**
   * Extracts a BufferdSource using the codec from this GridFSDBFile
   */
  def sourceWithCodec(codec: scala.io.Codec) = {
    scala.io.Source.fromInputStream(f.inputStream)(codec)
  }
}