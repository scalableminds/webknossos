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
package com.scalableminds.webknossos.datastore.jzarr.ucarutils;

import com.scalableminds.webknossos.datastore.jzarr.DataType;
import ucar.ma2.Array;
import ucar.ma2.IndexIterator;

public class NetCDF_Util {

    public static int[] netCDFOrder(int[] ints) {
        final int length = ints.length;
        final int[] netCDF = new int[length];
        for (int i = 0; i < length; i++) {
            netCDF[i] = ints[length - 1 - i];
        }
        return netCDF;
    }

    public static Array createArrayWithGivenStorage(Object storage, int[] shape) {
        final Class<?> aClass = storage.getClass();
        if (aClass.isArray()) {
            return Array.factory(ucar.ma2.DataType.getType(aClass.getComponentType(), false), shape, storage);
        }
        return null;
    }

    public static Array createFilledArray(ucar.ma2.DataType dataType, int[] shape, Number fill) {
        final Array array = Array.factory(dataType, shape);
        final IndexIterator iter = array.getIndexIterator();
        if (fill != null) {
            if (ucar.ma2.DataType.DOUBLE.equals(dataType)) {
                while (iter.hasNext()) {
                    iter.setDoubleNext(fill.doubleValue());
                }
            } else if (ucar.ma2.DataType.FLOAT.equals(dataType)) {
                while (iter.hasNext()) {
                    iter.setFloatNext(fill.floatValue());
                }
            } else if (ucar.ma2.DataType.LONG.equals(dataType)) {
                while (iter.hasNext()) {
                    iter.setLongNext(fill.longValue());
                }
            } else if (ucar.ma2.DataType.INT.equals(dataType)) {
                while (iter.hasNext()) {
                    iter.setIntNext(fill.intValue());
                }
            } else if (ucar.ma2.DataType.SHORT.equals(dataType)) {
                while (iter.hasNext()) {
                    iter.setShortNext(fill.shortValue());
                }
            } else if (ucar.ma2.DataType.BYTE.equals(dataType)) {
                while (iter.hasNext()) {
                    iter.setByteNext(fill.byteValue());
                }
            } else {
                throw new IllegalStateException();
            }
        }
        return array;
    }

    public static ucar.ma2.DataType getDataType(DataType dataType) {
        if (dataType == DataType.f8) {
            return ucar.ma2.DataType.DOUBLE;
        } else if (dataType == DataType.f4) {
            return ucar.ma2.DataType.FLOAT;
        } else if (dataType == DataType.i8 ) {
            return ucar.ma2.DataType.LONG;
        } else if (dataType == DataType.i4 || dataType == DataType.u4) {
            return ucar.ma2.DataType.INT;
        } else if (dataType == DataType.i2 || dataType == DataType.u2) {
            return ucar.ma2.DataType.SHORT;
        }
        return ucar.ma2.DataType.BYTE;
    }
}
