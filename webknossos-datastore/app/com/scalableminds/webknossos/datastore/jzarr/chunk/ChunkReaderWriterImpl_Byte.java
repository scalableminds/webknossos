/*
 *
 * MIT License
 *
 * Copyright (c) 2020. Brockmann Consult GmbH (info@brockmann-consult.de)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */
package com.scalableminds.webknossos.datastore.jzarr.chunk;

import com.scalableminds.webknossos.datastore.jzarr.Compressor;
import com.scalableminds.webknossos.datastore.jzarr.storage.Store;
import ucar.ma2.Array;
import ucar.ma2.DataType;

import java.io.*;

public class ChunkReaderWriterImpl_Byte extends ChunkReaderWriter {

    public ChunkReaderWriterImpl_Byte(Compressor compressor, int[] chunkShape, Number fill, Store store) {
        super(null, compressor, chunkShape, fill, store);
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
                    final byte[] b = os.toByteArray();
                    return Array.factory(DataType.BYTE, chunkShape, b);
                }
            } else {
                return createFilled(DataType.BYTE);
            }
        }
    }

    @Override
    public void write(String storeKey, Array array) throws IOException {
        final byte[] bytes = (byte[]) array.get1DJavaArray(DataType.BYTE);
        try (
                final ByteArrayInputStream is = new ByteArrayInputStream(bytes);
                final OutputStream os = store.getOutputStream(storeKey)
        ) {
            compressor.compress(is, os);
        }
    }
}
