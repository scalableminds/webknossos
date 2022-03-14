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
import com.scalableminds.webknossos.datastore.jzarr.storage.Store;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.PrettyPrinter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;
import ucar.ma2.Array;
import ucar.ma2.MAMath;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Collectors;

import static com.scalableminds.webknossos.datastore.jzarr.ZarrConstants.FILENAME_DOT_ZATTRS;

public final class ZarrUtils {

    private static ObjectMapper objectMapper;

    public static String toJson(Object src) throws JZarrException {
        return toJson(src, false);
    }

    public static String toJson(Object src, boolean prettyPrinting) throws JZarrException {
        try {
            return getObjectWriter(prettyPrinting).writeValueAsString(src);
        } catch (JsonProcessingException e) {
            throw new JZarrException("Unable to convert the source object to json.", e);
        }
    }

    public static void toJson(Object o, Writer writer) throws IOException {
        toJson(o, writer, false);
    }

    public static void toJson(Object o, Writer writer, boolean prettyPrinting) throws IOException {
        getObjectWriter(prettyPrinting).writeValue(writer, o);
    }

    public static int[][] computeChunkIndices(int[] arrayShape, int[] arrayChunkSize, int[] selectedShape, int[] selectedOffset) {
        final int depth = arrayShape.length;
        int[] start = new int[depth];
        int[] end = new int[depth];
        int numChunks = 1;
        for (int dim = 0; dim < depth; dim++) {
            final int startIdx = selectedOffset[dim] / arrayChunkSize[dim];
            final int maxIdx = (arrayShape[dim] - 1) / arrayChunkSize[dim];
            int endIdx = (selectedOffset[dim] + selectedShape[dim] - 1) / arrayChunkSize[dim];
            endIdx = Math.min(endIdx, maxIdx);
            start[dim] = startIdx;
            end[dim] = endIdx;
            numChunks *= (endIdx - startIdx + 1);
        }

        final int[][] chunkIndices = new int[numChunks][];

        final int[] currentIdx = Arrays.copyOf(start, depth);
        for (int i = 0; i < chunkIndices.length; i++) {
            chunkIndices[i] = Arrays.copyOf(currentIdx, depth);
            int depthIdx = depth - 1;
            while (depthIdx >= 0) {
                if (currentIdx[depthIdx] >= end[depthIdx]) {
                    currentIdx[depthIdx] = start[depthIdx];
                    depthIdx--;
                } else {
                    currentIdx[depthIdx]++;
                    depthIdx = -1;
                }
            }
        }
        return chunkIndices;
    }

    public static String createChunkFilename(int[] currentIdx, String separatorChar) {
        StringBuilder sb = new StringBuilder();
        for (int aCurrentIdx : currentIdx) {
            sb.append(aCurrentIdx);
            sb.append(separatorChar);
        }
        sb.setLength(sb.length() - 1);
        return sb.toString();
    }

    public static <T> T fromJson(Reader reader, final Class<T> classOfType) throws IOException {
        ObjectMapper objectMapper = getObjectMapper();
        return objectMapper.readValue(reader, classOfType);
    }

    public static long computeSize(int[] ints) {
        long count = 1;
        for (int i : ints) {
            count *= i;
        }
        return count;
    }

    public static int computeSizeInteger(int[] ints) {
        int count = 1;
        for (int i : ints) {
            count *= i;
        }
        return count;
    }

    static ObjectWriter getObjectWriter(boolean prettyPrinting) {
        if (prettyPrinting) {
            PrettyPrinter prettyPrinter = new DefaultPrettyPrinter().withArrayIndenter(DefaultPrettyPrinter.FixedSpaceIndenter.instance);
            return getObjectMapper().writer(prettyPrinter);
        }
        return getObjectMapper().writer();
    }

    static synchronized ObjectMapper getObjectMapper() {
        if (objectMapper == null) {
            objectMapper = new ObjectMapper();
            ZarrHeader.register(objectMapper);
        }
        return objectMapper;
    }

    public static void ensureFileExistAndIsReadable(Path dotZGroupPath) throws IOException {
        if (!Files.exists(dotZGroupPath) || Files.isDirectory(dotZGroupPath) || !Files.isReadable(dotZGroupPath)) {
            throw new IOException("File '" + dotZGroupPath.getFileName() + "' is not readable or missing in directory " + dotZGroupPath.getParent() + " .");
        }
    }

    public static void ensureDirectory(Path groupPath) throws IOException {
        if (groupPath == null || !Files.isDirectory(groupPath)) {
            throw new IOException("Path '" + groupPath + "' is not a valid path or not a directory.");
        }
    }

    public static Map<String, Object> readAttributes(ZarrPath zarrPath, Store store) throws IOException {
        final ZarrPath attrPath = zarrPath.resolve(FILENAME_DOT_ZATTRS);
        try (InputStream inputStream = store.getInputStream(attrPath.storeKey)) {
            if (inputStream == null) {
                return new HashMap<>();
            }
            return fromJson(new InputStreamReader(inputStream), Map.class);
        }
    }

    public static void deleteDirectoryTreeRecursively(Path toBeDeleted) throws IOException {
        final List<Path> paths = Files.walk(toBeDeleted).sorted(Comparator.reverseOrder()).collect(Collectors.toList());
        for (Path path : paths) {
            Files.delete(path);
        }
    }

    public static Object createDataBufferFilledWith(Number value, DataType dataType, int[] shape) {
        final Object dataBuffer = createDataBuffer(dataType, shape);
        ucar.ma2.DataType aType = ucar.ma2.DataType.getType(dataBuffer.getClass().getComponentType(), false);
        Array array = Array.factory(aType, shape, dataBuffer);
        MAMath.setDouble(array, value.doubleValue());
        return array.getStorage();
    }

    public static Object createDataBuffer(DataType dataType, int[] shape) {
        final int size = computeSizeInteger(shape);
        switch (dataType) {
            case i1:
            case u1:
                return new byte[size];
            case i2:
            case u2:
                return new short[size];
            case i4:
            case u4:
                return new int[size];
            case i8:
                return new long[size];
            case f4:
                return new float[size];
            case f8:
                return new double[size];
        }
        return null;
    }

    public static String normalizeStoragePath(String path) {

        //replace backslashes with slashes
        path = path.replace("\\", "/");

        // collapse any repeated slashes
        while (path.contains("//")) {
            path = path.replace("//", "/");
        }

        // ensure no leading slash
        if (path.startsWith("/")) {
            path = path.substring(1);
        }

        // ensure no trailing slash
        if (path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }

        // don't allow path segments with just '.' or '..'
        final String[] split = path.split("/");
        for (String s : split) {
            s = s.trim();
            if (".".equals(s) || "..".equals(s)) {
                throw new IllegalArgumentException("path containing '.' or '..' segment not allowed");
            }
        }
        return path;
    }

}
