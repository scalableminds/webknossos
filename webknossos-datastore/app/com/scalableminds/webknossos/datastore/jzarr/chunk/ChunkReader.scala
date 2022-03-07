package com.scalableminds.webknossos.datastore.jzarr.chunk

import com.scalableminds.webknossos.datastore.jzarr.storage.Store
import com.scalableminds.webknossos.datastore.jzarr.{Compressor, DataType}

case class ChunkReader(
    compressor: Compressor,
    chunkShape: Array[Int],
    store: Store,
    dataType: DataType,
) {
  /*

  private lazy val chunkElementCount = computeSizeInteger(chunkShape)
  private lazy val bytesPerElement = bytesPerElement(dataType)

  @throws[IOException]
  def read(storeKey: String): Array[Byte] = {
    val is = store.getInputStream(storeKey)
    val os: ByteArrayOutputStream = new ByteArrayOutputStream()
    compressor.uncompress(is, os)
    os.toByteArray
  }




    @Override
    public Array read(String storeKey) throws IOException {
        try (
                final InputStream is = store.getInputStream(storeKey)
        ) {
            if (is != null) {
                try (
                        final ByteArrayOutputStream os = new ByteArrayOutputStream()
                ) {
                    compressor.uncompress(is, os);
                    final int[] ints = new int[getSize()];
                    try (
                            final ByteArrayInputStream bais = new ByteArrayInputStream(os.toByteArray());
                            final ImageInputStream iis = new MemoryCacheImageInputStream(bais)
                    ) {
                        iis.setByteOrder(order);
                        iis.readFully(ints, 0, ints.length);
                    }
                    return Array.factory(DataType.INT, chunkShape, ints);
                }
            } else {
                return createFilled(DataType.INT);
            }
        }
    }

 */

}
