package oxalis.util

import com.mongodb.casbah.gridfs.Imports._

object ExtendedTypes {

  implicit class ExtendedGridFSDBFile(val f: GridFSDBFile) extends AnyVal {
    /**
     * Extracts a BufferdSource using the codec from this GridFSDBFile
     */
    def sourceWithCodec(codec: scala.io.Codec) = {
      scala.io.Source.fromInputStream(f.inputStream)(codec)
    }
  }
}