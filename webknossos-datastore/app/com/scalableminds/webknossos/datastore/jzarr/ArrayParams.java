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

package com.scalableminds.webknossos.datastore.jzarr;

import com.scalableminds.webknossos.datastore.jzarr.storage.Store;

import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.Map;

/**
 * The class ArrayParams implements the Builder pattern. It is used on java side to imitate the pythonic default
 * value feature for function arguments. So the recognition factor for users who are familiar with the python zarr
 * framework should be high. E.g.: <br/>
 * <br/>
 * Python example:
 * <pre>
 *    za = zarr.create(
 *        shape=(12, 10000, 5000),
 *        chunks=(12, 200, 200),
 *        dtype='>u4',
 *        compressor=Zlib(level=1),
 *        fill_value=-1)
 * </pre>
 * Java example:
 * <pre>
 *    ZarrArray za = ZarrArray.create(new ArrayParams()
 *         .shape(12, 10000, 5000)
 *         .chunks(12, 200, 200)
 *         .dataType(DataType.u4)
 *         .byteOrder(ByteOrder.BIG_ENDIAN)
 *         .compressor(CompressorFactory.create("zlib", 1))
 *         .fillValue(-1)
 *    );
 * </pre>
 * Shape must be given!<br/>
 * <br/>
 * If not given ... parameter default values are:
 * <pre>
 *   boolean chunked = true;
 *   DataType dataType = {@link DataType#f8};
 *   ByteOrder byteOrder = {@link ByteOrder#BIG_ENDIAN};
 *   Number fillValue = 0;
 *   Compressor compressor = {@link CompressorFactory#createDefaultCompressor()};
 *   DimensionSeparator sep = {@link DimensionSeparator#DOT};
 * </pre>
 */
public class ArrayParams {
    private int[] shape;
    private int[] chunks;
    private boolean chunked = true;
    private DataType dataType = DataType.f8;
    private ByteOrder byteOrder = ByteOrder.BIG_ENDIAN;
    private Number fillValue = 0;
    private Compressor compressor = CompressorFactory.createDefaultCompressor();
    private DimensionSeparator separator = DimensionSeparator.DOT;

    /**
     * Sets the mandatory {@code shape} and returns a reference to this Builder so that the methods can be chained together.
     *
     * @param shape the {@code shape} to set
     * @return a reference to this Builder
     */
    public ArrayParams shape(int... shape) {
        this.shape = shape;
        return this;
    }

    /**
     * Sets the optional {@code chunks} and returns a reference to this Builder so that the methods can be chained together.<br/>
     * The number of dimensions must be equal to the number of dimensions of the shape.
     *
     * @param chunks the {@code chunks} to set.
     * @return a reference to this Builder
     */
    public ArrayParams chunks(int... chunks) {
        this.chunks = chunks;
        return this;
    }

    /**
     * Sets the optional {@code chunked} and returns a reference to this Builder so that the methods can be chained together.<br/>
     * If no chunks is given and chunked is true, chunks will be calculated using an heuristic algorithm.<br/>
     * If chunked is false und no chunks are set, only one chunk with the full array shape will be created.<br/>
     * Default value: <code>true</code>
     *
     * @param chunked the {@code chunked} to set
     * @return a reference to this Builder
     */
    public ArrayParams chunked(boolean chunked) {
        this.chunked = chunked;
        return this;
    }

    /**
     * Sets the optional {@code dataType} and returns a reference to this Builder so that the methods can be chained together.<br/>
     * Default value: {@link DataType#f8}
     *
     * @param dataType the {@code dataType} to set
     * @return a reference to this Builder
     */
    public ArrayParams dataType(DataType dataType) {
        this.dataType = dataType;
        return this;
    }

    /**
     * Sets the optional {@code byteOrder} and returns a reference to this Builder so that the methods can be chained together.<br/>
     * Default value: {@link ByteOrder#BIG_ENDIAN}
     *
     * @param byteOrder the {@code byteOrder} to set
     * @return a reference to this Builder
     */
    public ArrayParams byteOrder(ByteOrder byteOrder) {
        this.byteOrder = byteOrder;
        return this;
    }

    /**
     * Sets the optional {@code fillValue} and returns a reference to this Builder so that the methods can be chained together.<br/>
     * Default value: {@code 0}
     *
     * @param fillValue the {@code fillValue} to set
     * @return a reference to this Builder
     */
    public ArrayParams fillValue(Number fillValue) {
        this.fillValue = fillValue;
        return this;
    }

    /**
     * Sets the optional {@code compressor} and returns a reference to this Builder so that the methods can be chained together.<br/>
     * An argument {@code null} will be converted to {@link CompressorFactory#nullCompressor}.<br/>
     * If this method is not used, the default compressor {@link CompressorFactory#createDefaultCompressor()} remains unchanged.
     *
     * @param compressor the {@link Compressor} to set or {@code null}
     * @return a reference to this Builder
     */
    public ArrayParams compressor(Compressor compressor) {
        if (compressor == null) {
            compressor = CompressorFactory.nullCompressor;
        }
        this.compressor = compressor;
        return this;
    }

    /**
     * Sets the optional {@code dimension_separator} and returns a reference to this Builder so that the methods can be chained together.<br/>
     * An argument {@code null} will be converted to {@link DimensionSeparator#DOT}.<br/>
     * If this method is not used, the default separator {@link DimensionSeparator#DOT} remains unchanged.
     *
     * @param sep the {@link DimensionSeparator} to set or {@code null}
     * @return a reference to this Builder
     */
    public ArrayParams dimensionSeparator(DimensionSeparator sep) {
        if (sep == null) {
            this.separator = DimensionSeparator.DOT;
        }
        this.separator = sep;
        return this;
    }

    /**
     * Returns {@link Params} built from the parameters previously set.<br/>
     * This method is package local and should  be used by framework itself only.<br/>
     *
     * @return {@link Params}
     */
    Params build() {
        if (shape == null || shape.length == 0) {
            throw new IllegalArgumentException("Shape must be given.");
        }
        if (chunks == null) {
            if (chunked) {
                chunks = new int[shape.length];
                for (int i = 0; i < shape.length; i++) {
                    int shapeDim = shape[i];
                    final int numChunks = (shapeDim / 512);
                    if (numChunks > 0) {
                        int chunkDim = shapeDim / (numChunks + 1);
                        if (shapeDim % chunkDim == 0) {
                            chunks[i] = chunkDim;
                        } else {
                            chunks[i] = chunkDim + 1;
                        }
                    } else {
                        chunks[i] = shapeDim;
                    }
                }
            } else {
                chunks = Arrays.copyOf(shape, shape.length);
            }
        }

        if (shape.length != chunks.length) {
            throw new IllegalArgumentException(
                    "Chunks must have the same number of dimensions as shape. " +
                    "Expected: " + shape.length + " but was " + chunks.length + " !");
        }

        for (int i = 0; i < chunks.length; i++) {
            int chunkDim = chunks[i];
            if (chunkDim < 1) {
                chunks[i] = shape[i];
            }
        }

        return new Params(shape, chunks, dataType, byteOrder, fillValue, compressor, separator);
    }

    /**
     * {@link ArrayParams} builder static inner class.
     */
    public static final class Params {
        private final int[] shape;
        private final int[] chunks;
        private final DataType dataType;
        private final ByteOrder byteOrder;
        private final Number fillValue;
        private final Compressor compressor;
        private final DimensionSeparator separator;

        private Params(int[] shape, int[] chunks, DataType dataType, ByteOrder byteOrder, Number fillValue, Compressor compressor, DimensionSeparator separator) {
            this.shape = shape;
            this.chunks = chunks;
            this.dataType = dataType;
            this.byteOrder = byteOrder;
            this.fillValue = fillValue;
            this.compressor = compressor;
            this.separator = separator;
        }

        public int[] getShape() {
            return shape;
        }

        public int[] getChunks() {
            return chunks;
        }

        public boolean isChunked() {
            return !Arrays.equals(shape, chunks);
        }

        public DataType getDataType() {
            return dataType;
        }

        public ByteOrder getByteOrder() {
            return byteOrder;
        }

        public Number getFillValue() {
            return fillValue;
        }

        public Compressor getCompressor() {
            return compressor;
        }

        public DimensionSeparator getDimensionSeparator() {
            return separator;
        }

        public ArrayParams toBuilder() {
            ArrayParams builder = new ArrayParams();
            builder.shape = getShape();
            builder.chunks = getChunks();
            builder.chunked = isChunked();
            builder.dataType = getDataType();
            builder.byteOrder = getByteOrder();
            builder.fillValue = getFillValue();
            builder.compressor = getCompressor();
            builder.separator = getDimensionSeparator();
            return builder;
        }
    }
}
