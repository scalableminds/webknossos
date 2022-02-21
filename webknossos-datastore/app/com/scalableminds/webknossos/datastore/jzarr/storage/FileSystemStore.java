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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.FileSystem;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class FileSystemStore implements Store {

    private final Path internalRoot;

    public FileSystemStore(String path, FileSystem fileSystem) {
        if (fileSystem == null) {
            internalRoot = Paths.get(path);
        } else {
            internalRoot = fileSystem.getPath(path);
        }
    }

    public FileSystemStore(Path rootPath) {
        internalRoot = rootPath;
    }

    @Override
    public InputStream getInputStream(String key) throws IOException {
        final Path path = internalRoot.resolve(key);
        //if (Files.isReadable(path)) {
            byte[] bytes = Files.readAllBytes(path);
            return new ByteArrayInputStream(bytes);
        //}
        //return null;
    }

    @Override
    public OutputStream getOutputStream(String key) {
        return new ByteArrayOutputStream() {
            private boolean closed = false;

            @Override
            public void close() throws IOException {
                try {
                    if (!closed) {
                        final byte[] bytes = this.toByteArray();
                        final Path filePath = internalRoot.resolve(key);
                        if (Files.exists(filePath)) {
                            Files.delete(filePath);
                        } else {
                            Files.createDirectories(filePath.getParent());
                        }
                        Files.write(filePath, bytes);
                    }
                } finally {
                    closed = true;
                }
            }
        };
    }

    @Override
    public void delete(String key) throws IOException {
        final Path toBeDeleted = internalRoot.resolve(key);
        if (Files.isDirectory(toBeDeleted)) {
            ZarrUtils.deleteDirectoryTreeRecursively(toBeDeleted);
        }
        if (Files.exists(toBeDeleted)) {
            Files.delete(toBeDeleted);
        }
        if (Files.exists(toBeDeleted) || Files.isDirectory(toBeDeleted)) {
            throw new IOException("Unable to initialize " + toBeDeleted.toAbsolutePath().toString());
        }
    }

    @Override
    public TreeSet<String> getArrayKeys() throws IOException {
        return getParentsOf(ZarrConstants.FILENAME_DOT_ZARRAY);
    }

    @Override
    public TreeSet<String> getGroupKeys() throws IOException {
        return getParentsOf(ZarrConstants.FILENAME_DOT_ZGROUP);
    }

    private TreeSet<String> getParentsOf(String suffix) throws IOException {
        return getKeysEndingWith(suffix).stream()
                .map(s -> internalRoot.relativize(internalRoot.resolve(s).getParent()).toString())
                .collect(Collectors.toCollection(TreeSet::new));
    }

    @Override
    public TreeSet<String> getKeysEndingWith(String suffix) throws IOException {
        return Files.walk(internalRoot)
                .filter(path -> path.toString().endsWith(suffix))
                .map(path -> internalRoot.relativize(path).toString())
                .collect(Collectors.toCollection(TreeSet::new));
    }

    @Override
    public Stream<String> getRelativeLeafKeys(String key) throws IOException {
        final Path walkingRoot = internalRoot.resolve(key);
        return Files.walk(walkingRoot)
                .filter(path -> !Files.isDirectory(path))
                .map(path -> walkingRoot.relativize(path).toString())
                .map(ZarrUtils::normalizeStoragePath)
                .filter(s -> s.trim().length() > 0);
    }
}
