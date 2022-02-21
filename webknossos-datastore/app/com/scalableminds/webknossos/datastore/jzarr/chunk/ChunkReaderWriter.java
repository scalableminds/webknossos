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
import com.scalableminds.webknossos.datastore.jzarr.CompressorFactory;
import com.scalableminds.webknossos.datastore.jzarr.DataType;
import com.scalableminds.webknossos.datastore.jzarr.storage.Store;
import com.scalableminds.webknossos.datastore.jzarr.ucar.NetCDF_Util;
import ucar.ma2.Array;

import java.io.IOException;
import java.nio.ByteOrder;
import java.util.Arrays;

import static com.scalableminds.webknossos.datastore.jzarr.ZarrUtils.computeSizeInteger;

public abstract class ChunkReaderWriter {

    protected final Compressor compressor;
    final int[] chunkShape;
    protected final Number fill;
    protected final Store store;
    protected final ByteOrder order;
    private final int size;

    ChunkReaderWriter(ByteOrder order, Compressor compressor, int[] chunkShape, Number fill, Store store) {
        if (compressor != null) {
            this.compressor = compressor;
        } else {
            this.compressor = CompressorFactory.nullCompressor;
        }
        this.chunkShape = Arrays.copyOf(chunkShape, chunkShape.length);
        this.fill = fill;
        this.size = computeSizeInteger(chunkShape);
        this.store = store;
        this.order = order;
    }

    public static ChunkReaderWriter create(Compressor compressor, DataType dataType, ByteOrder order, int[] chunkShape, Number fill, Store store) {
        if (dataType == DataType.f8) {
            return new ChunkReaderWriterImpl_Double(order, compressor, chunkShape, fill, store);
        } else if (dataType == DataType.f4) {
            return new ChunkReaderWriterImpl_Float(order, compressor, chunkShape, fill, store);
        } else if (dataType == DataType.i8) {
            return new ChunkReaderWriterImpl_Long(order, compressor, chunkShape, fill, store);
        } else if (dataType == DataType.i4 || dataType == DataType.u4) {
            return new ChunkReaderWriterImpl_Integer(order, compressor, chunkShape, fill, store);
        } else if (dataType == DataType.i2 || dataType == DataType.u2) {
            return new ChunkReaderWriterImpl_Short(order, compressor, chunkShape, fill, store);
        } else if (dataType == DataType.i1 || dataType == DataType.u1) {
            return new ChunkReaderWriterImpl_Byte(compressor, chunkShape, fill, store);
        } else {
            throw new IllegalStateException();
        }
    }

    public abstract Array read(String path) throws IOException;

    public abstract void write(String path, Array array) throws IOException;

    protected Array createFilled(final ucar.ma2.DataType dataType) {
        return NetCDF_Util.createFilledArray(dataType, chunkShape, fill);
    }

    protected int getSize() {
        return this.size;
    }

}
