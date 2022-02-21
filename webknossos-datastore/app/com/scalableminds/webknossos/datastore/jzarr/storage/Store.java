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

package com.scalableminds.webknossos.datastore.jzarr.storage;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.TreeSet;
import java.util.stream.Stream;

/**
 * Store interface according to https://zarr.readthedocs.io/en/stable/spec/v2.html#storage
 * A Zarr array can be stored in any storage system that provides a key/value interface, where
 * a key is an ASCII string and a value is an arbitrary sequence of bytes, and the supported
 * operations are read (get the sequence of bytes associated with a given key), write (set the
 * sequence of bytes associated with a given key) and delete (remove a key/value pair).
 */
public interface Store extends Closeable {

    InputStream getInputStream(String key) throws IOException;

    OutputStream getOutputStream(String key) throws IOException;

    void delete(String key) throws IOException;

    TreeSet<String> getArrayKeys() throws IOException;

    TreeSet<String> getGroupKeys() throws IOException;

    TreeSet<String> getKeysEndingWith(String suffix) throws IOException;

    Stream<String> getRelativeLeafKeys(String key) throws IOException;

    @Override
    default void close() throws IOException {
    }
}
