package com.scalableminds.webknossos.datastore.compresso;
import java.nio.file.*;
class NativeCompressoCompressor {native byte[] decompress(byte[] bytes);}
public class GenerateCompressoFixtures {
    public static void main(String[] args)throws Exception {
        System.load(args[0]);var converter=new NativeCompressoCompressor();
        try {var bytes=converter.decompress(Files.readAllBytes(Path.of(args[1])));Files.write(Path.of(args[2]),bytes);}
        catch(Exception error){System.out.println(error.getMessage());System.exit(2);}
    }
}
