package com.scalableminds.webknossos.datastore.draco;
import java.nio.file.Path;
import java.nio.file.Files;
class NativeDracoToStlConverter {
    native byte[] dracoToStl(byte[] bytes,float x,float y,float z,double sx,double sy,double sz,int bits);
}
public class GenerateDracoFixtures {
    public static void main(String[] args) throws Exception {
        System.load(args[0]);
        var converter=new NativeDracoToStlConverter();
        var input=Files.readAllBytes(Path.of(args[1]));
        int bits=Integer.parseInt(args[3]);
        byte[] output=converter.dracoToStl(input,
            args.length>4?Float.parseFloat(args[4]):10.25f,args.length>4?Float.parseFloat(args[5]):-20.5f,args.length>4?Float.parseFloat(args[6]):.125f,
            args.length>4?Double.parseDouble(args[7]):2.5,args.length>4?Double.parseDouble(args[8]):.75,args.length>4?Double.parseDouble(args[9]):4.,bits);
        Files.write(Path.of(args[2]),output);
    }
}
