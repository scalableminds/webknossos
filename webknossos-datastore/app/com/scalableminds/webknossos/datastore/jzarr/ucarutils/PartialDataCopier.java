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

import ucar.ma2.Array;
import ucar.ma2.IndexIterator;
import ucar.ma2.InvalidRangeException;
import ucar.ma2.Range;

import java.util.ArrayList;

/**
 * @author sabine.bc
 */
public class PartialDataCopier {

    /**
     * Offset describes the displacement between source and target array.<br/>
     * <br/>
     * For example in the case of one dimensional arrays:<br/>
     * <pre>
     *     source array initialized { 1, 2, 3, 4, 5, 6, 7, 8, 9 }
     *     target array initialized { -1, -1, -1 }
     * </pre><br/>
     * An offset of 3 means that the target arrays will be displayed that way:<br/>
     * <pre>
     *     source   { 1, 2, 3, 4, 5, 6, 7, 8, 9 }
     *     target            { 4, 5, 6 }
     * </pre>
     * An offset of -2 means that the target arrays will be displayed that way:<br/>
     * <pre>
     *     source           { 1, 2, 3, 4, 5, 6, 7, 8, 9 }
     *     target   { -1, -1, 1 }
     * </pre>
     *
     * @param offset - the displacement between source and target
     * @param source - the source array
     * @param target - the target array
     */
    public static void copy(int[] offset, Array source, Array target) throws InvalidRangeException {

        final int[] sourceShape = source.getShape();
        final int[] targetShape = target.getShape();
        final ArrayList<Range> sourceRanges = new ArrayList<>();
        final ArrayList<Range> targetRanges = new ArrayList<>();
        for (int dimension = 0; dimension < offset.length; dimension++) {
            int dimOffset = offset[dimension];
            int sourceFirst;
            int targetFirst;
            if (dimOffset >= 0) {
                sourceFirst = dimOffset;
                targetFirst = 0;
            } else {
                sourceFirst = 0;
                targetFirst = dimOffset * -1;
            }
            final int maxSSteps = sourceShape[dimension] - sourceFirst;
            final int maxTSteps = targetShape[dimension] - targetFirst;
            final int maxSteps = Math.min(maxSSteps, maxTSteps);
            int sourceLast = sourceFirst + maxSteps;
            int targetLast = targetFirst + maxSteps;

            sourceRanges.add(new Range(sourceFirst, sourceLast - 1));
            targetRanges.add(new Range(targetFirst, targetLast - 1));
        }
        final IndexIterator sourceRangeIterator = source.getRangeIterator(sourceRanges);
        final IndexIterator targetRangeIterator = target.getRangeIterator(targetRanges);
        final Class elementType = source.getElementType();
        ValueSetter setter = createValueSetter(elementType);
        while (sourceRangeIterator.hasNext()) {
            setter.set(sourceRangeIterator, targetRangeIterator);
        }
    }

    private static ValueSetter createValueSetter(Class elementType) {
        if (elementType == double.class) {
            return (sourceIterator, targetIterator) -> targetIterator.setDoubleNext(sourceIterator.getDoubleNext());
        } else if (elementType == float.class) {
            return (sourceIterator, targetIterator) -> targetIterator.setFloatNext(sourceIterator.getFloatNext());
        } else if (elementType == long.class) {
            return (sourceIterator, targetIterator) -> targetIterator.setLongNext(sourceIterator.getLongNext());
        } else if (elementType == int.class) {
            return (sourceIterator, targetIterator) -> targetIterator.setIntNext(sourceIterator.getIntNext());
        } else if (elementType == short.class) {
            return (sourceIterator, targetIterator) -> targetIterator.setShortNext(sourceIterator.getShortNext());
        } else if (elementType == byte.class) {
            return (sourceIterator, targetIterator) -> targetIterator.setByteNext(sourceIterator.getByteNext());
        }
        return (sourceIterator, targetIterator) -> targetIterator.setObjectNext(sourceIterator.getObjectNext());
    }

    private interface ValueSetter {

        void set(IndexIterator sourceIterator, IndexIterator targetIterator);
    }
}

