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

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public abstract class Compressor {

    public abstract String getId();

    public abstract String toString();

    public abstract void compress(InputStream is, OutputStream os) throws IOException;

    public abstract void uncompress(InputStream is, OutputStream os) throws IOException;

    void passThrough(InputStream is, OutputStream os) throws IOException {
        final byte[] bytes = new byte[4096];
        int read = is.read(bytes);
        while (read >= 0) {
            if (read > 0) {
                os.write(bytes, 0, read);
            }
            read = is.read(bytes);
        }
    }
}
