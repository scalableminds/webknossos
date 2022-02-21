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

import com.scalableminds.webknossos.datastore.jzarr.storage.FileSystemStore;
import com.scalableminds.webknossos.datastore.jzarr.storage.InMemoryStore;
import com.scalableminds.webknossos.datastore.jzarr.storage.Store;

import java.io.*;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.Map;
import java.util.Set;

import static com.scalableminds.webknossos.datastore.jzarr.ZarrConstants.*;

public class ZarrGroup {

    public static ZarrGroup create() throws IOException {
        return create((String) null);
    }

    public static ZarrGroup create(String path) throws IOException {
        return create(path, null);
    }

    /**
     * @param path
     * @param attributes
     * @throws IOException
     */
    public static ZarrGroup create(String path, final Map<String, Object> attributes) throws IOException {
        if (path == null) {
            return create(new InMemoryStore(), attributes);
        }
        return create(Paths.get(path), attributes);
    }

    public static ZarrGroup create(Path fileSystemPath) throws IOException {
        return create(fileSystemPath, null);
    }

    public static ZarrGroup create(Path fileSystemPath, final Map<String, Object> attributes) throws IOException {
        return create(new FileSystemStore(fileSystemPath), attributes);
    }

    public static ZarrGroup create(Store store) throws IOException {
        return create(store, null);
    }

    public static ZarrGroup create(Store store, final Map<String, Object> attributes) throws IOException {
        ZarrGroup zarrGroup = new ZarrGroup(store);
        zarrGroup.createHeader();
        zarrGroup.writeAttributes(attributes);
        return zarrGroup;
    }

    public static ZarrGroup open(String path) throws IOException {
        if (path == null) {
            return create();
        }
        return open(Paths.get(path));
    }

    public static ZarrGroup open(Path fileSystemPath) throws IOException {
        if (fileSystemPath == null) {
            return create();
        }
        ZarrUtils.ensureDirectory(fileSystemPath);
        return open(new FileSystemStore(fileSystemPath));
    }

    public static ZarrGroup open(Store store) throws IOException {
        if (store == null) {
            return create();
        }
        validateGroupToBeOpened(store, new ZarrPath(""));
        return new ZarrGroup(store);
    }

    private static void validateGroupToBeOpened(Store store, ZarrPath relativePath) throws IOException {
        try (InputStream is = store.getInputStream(relativePath.resolve(FILENAME_DOT_ZGROUP).storeKey)) {
            if (is == null) {
                throw new IOException("'" + FILENAME_DOT_ZGROUP + "' expected but is not readable or missing in store.");
            }
            ensureZarrFormatIs2(is);
        }
    }

    private static void ensureZarrFormatIs2(InputStream is) throws IOException {
        try (
                final InputStreamReader in = new InputStreamReader(is);
                BufferedReader reader = new BufferedReader(in)
        ) {
            final ZarrFormat fromJson = ZarrUtils.fromJson(reader, ZarrFormat.class);
            if (fromJson.zarr_format != 2) {
                throw new IOException("Zarr format 2 expected but is '" + fromJson.zarr_format + "'");
            }
        }
    }

    public ZarrGroup createSubGroup(String subGroupName) throws IOException {
        return createSubGroup(subGroupName, null);
    }

    public ZarrGroup createSubGroup(String subGroupName, Map<String, Object> attributes) throws IOException {
        final ZarrPath relativePath = this.relativePath.resolve(subGroupName);
        final ZarrGroup group = new ZarrGroup(store, relativePath);
        group.createHeader();
        group.writeAttributes(attributes);
        return group;
    }

    public ZarrGroup openSubGroup(String subGroupName) throws IOException {
        final ZarrPath relativePath = this.relativePath.resolve(subGroupName);
        validateGroupToBeOpened(store, relativePath);
        return new ZarrGroup(store, relativePath);
    }

    private final static class ZarrFormat {
        public double zarr_format;
    }

    private final Store store;
    private final ZarrPath relativePath;

    private ZarrGroup(Store store) {
        this.relativePath = new ZarrPath("");
        this.store = store;
    }

    private ZarrGroup(Store store, ZarrPath relativePath) {
        this.relativePath = relativePath;
        this.store = store;
    }

    public ZarrArray createArray(String name, ArrayParams params) throws IOException {
        return createArray(name, params, null);
    }

    public ZarrArray createArray(String name, ArrayParams params, final Map<String, Object> attributes) throws IOException {
        final ZarrPath relativePath = this.relativePath.resolve(name);
        return ZarrArray.create(relativePath, store, params, attributes);
    }

    public ZarrArray openArray(String name) throws IOException {
        final ZarrPath relativePath = this.relativePath.resolve(name);
        return ZarrArray.open(relativePath, store);
    }

    public Set<String> getArrayKeys() throws IOException {
        return store.getArrayKeys();
    }

    public Set<String> getGroupKeys() throws IOException {
        final Set<String> groupKeys = store.getGroupKeys();
        groupKeys.remove("");
        return groupKeys;
    }

    public void writeAttributes(Map<String, Object> attributes) throws IOException {
        ZarrUtils.writeAttributes(attributes, relativePath, store);
    }

    public Map<String, Object> getAttributes() throws IOException {
        return ZarrUtils.readAttributes(relativePath, store);
    }

    @Override
    public String toString() {
        return getClass().getCanonicalName() + "{'/" + relativePath.storeKey + "'}";
    }


    private void createHeader() throws IOException {
        final Map<String, Integer> singletonMap = Collections.singletonMap(ZARR_FORMAT, 2);
        final ZarrPath headerPath = relativePath.resolve(FILENAME_DOT_ZGROUP);
        try (
                final OutputStream os = store.getOutputStream(headerPath.storeKey);
                final OutputStreamWriter writer = new OutputStreamWriter(os)
        ) {
            ZarrUtils.toJson(singletonMap, writer, true);
        }
    }
}
