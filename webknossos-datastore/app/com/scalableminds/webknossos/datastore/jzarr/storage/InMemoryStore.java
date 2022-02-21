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

import com.scalableminds.webknossos.datastore.jzarr.ZarrConstants;
import com.scalableminds.webknossos.datastore.jzarr.ZarrUtils;

import java.io.*;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class InMemoryStore implements Store {
    private final Map<String, byte[]> map = new HashMap<>();

    @Override
    public InputStream getInputStream(String key) {
        final byte[] bytes = map.get(key);
        if (bytes != null) {
            return new ByteArrayInputStream(bytes);
        } else {
            return null;
        }
    }

    @Override
    public OutputStream getOutputStream(String key) {
        return new ByteArrayOutputStream() {
            @Override
            public void close() {
                map.remove(key);
                map.put(key, this.toByteArray());
            }
        };
    }

    @Override
    public void delete(String key) {
        map.remove(key);
    }

    @Override
    public TreeSet<String> getArrayKeys() {
        return getParentsOf(ZarrConstants.FILENAME_DOT_ZARRAY);
    }

    @Override
    public TreeSet<String> getGroupKeys() {
        return getParentsOf(ZarrConstants.FILENAME_DOT_ZGROUP);
    }

    private TreeSet<String> getParentsOf(String suffix) {
        return getKeysEndingWith(suffix).stream()
                .map(s -> {
                    String relKey = s.replace(suffix, "");
                    while (relKey.endsWith("/")) {
                        relKey = relKey.substring(0, relKey.length() - 1);
                    }
                    return relKey;
                })
                .collect(Collectors.toCollection(TreeSet::new));
    }

    @Override
    public TreeSet<String> getKeysEndingWith(String suffix) {
        final Set<String> keySet = map.keySet();
        final TreeSet<String> arrayKeys = new TreeSet<>();
        for (String key : keySet) {
            if (key.endsWith(suffix)) {
                arrayKeys.add(key);
            }
        }
        return arrayKeys;
    }

    @Override
    public Stream<String> getRelativeLeafKeys(String key) throws IOException {
        final Set<String> keySet = map.keySet();
        return keySet.stream()
                .filter(s -> !s.equals(key) && s.startsWith(key))
                .map(s -> s.replace(key, ""))
                .map(ZarrUtils::normalizeStoragePath);
    }
}
