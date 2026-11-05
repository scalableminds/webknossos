package com.scalableminds.webknossos.datastore.helpers;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.Base64;

// Oracle only: compile the repository bucketScanner.cpp + jniutils.cpp into a temporary dylib.
// The Rust datastore never links this native library.
class NativeBucketScanner {
    native long countSegmentVoxels(byte[] bytes, int width, boolean signed, long id);
    native int[] extendSegmentBoundingBox(byte[] bytes, int width, boolean signed, int length,
        long id, int x, int y, int z, int minX, int minY, int minZ, int maxX, int maxY, int maxZ);
}
public class GenerateBucketScannerFixtures {
    static void put(ByteBuffer out, int width, long value) {
        switch (width) {
            case 1: out.put((byte)value); break;
            case 2: out.putShort((short)value); break;
            case 4: out.putInt((int)value); break;
            case 8: out.putLong(value); break;
            default: throw new IllegalArgumentException();
        }
    }
    public static void main(String[] args) {
        System.load(args[0]);
        var scanner = new NativeBucketScanner();
        System.out.println("[");
        boolean first = true;
        for (int width : new int[]{1,2,4,8}) for (boolean signed : new boolean[]{false,true}) {
            var input = ByteBuffer.allocate(width*6).order(ByteOrder.LITTLE_ENDIAN);
            for (long v : new long[]{0,2,-1,2,Long.MIN_VALUE,-1}) put(input,width,v);
            long high = signed || width==8 ? -1L : (1L<<(width*8))-1;
            for (long id : new long[]{0,2,high,Long.MIN_VALUE,7}) {
                if (!first) System.out.println(","); first=false;
                long count=scanner.countSegmentVoxels(input.array(),width,signed,id);
                System.out.print("{\"kind\":\"count\",\"width\":"+width+",\"signed\":"+signed+",\"id\":\""+id+"\",\"bytes\":\""+Base64.getEncoder().encodeToString(input.array())+"\",\"expected\":"+count+"}");
            }
            var bucket=ByteBuffer.allocate(width*32768).order(ByteOrder.LITTLE_ENDIAN);
            int[][] positions = {{0,1,2},{31,30,29},{5,6,7}};
            for (int[] p:positions) {bucket.position(width*(p[0]+32*p[1]+1024*p[2]));put(bucket,width,-1);}
            int[] bounds=scanner.extendSegmentBoundingBox(bucket.array(),width,signed,32,high,-32,64,96,Integer.MAX_VALUE,Integer.MAX_VALUE,Integer.MAX_VALUE,Integer.MIN_VALUE,Integer.MIN_VALUE,Integer.MIN_VALUE);
            System.out.println(",");
            System.out.print("{\"kind\":\"bounds\",\"width\":"+width+",\"signed\":"+signed+",\"id\":\""+high+"\",\"expected\":"+Arrays.toString(bounds)+"}");
        }
        System.out.println("\n]");
    }
}
