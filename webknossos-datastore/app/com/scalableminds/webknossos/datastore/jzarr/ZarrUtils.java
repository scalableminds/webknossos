package com.scalableminds.webknossos.datastore.jzarr;

import java.util.*;

public final class ZarrUtils {

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
