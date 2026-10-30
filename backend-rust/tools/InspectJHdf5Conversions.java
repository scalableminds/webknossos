import ch.systemsx.cisd.hdf5.HDF5Factory;
import java.util.Arrays;
// Diagnostic oracle: actual Scala dependency's uint64 block conversion, not a C API approximation.
public class InspectJHdf5Conversions {
    public static void main(String[] args) {
        var reader=HDF5Factory.openForReading(args[0]);
        for(String name:Arrays.copyOfRange(args,1,args.length)) {
            try {
                if(name.startsWith("float:"))System.out.println(name+" "+Arrays.toString(reader.float32().readArrayBlockWithOffset(name.substring(6),999,0)));
                else if(name.startsWith("attr:"))System.out.println(name+" "+reader.uint64().getAttr("/",name.substring(5)));
                else System.out.println(name+" "+Arrays.toString(reader.uint64().readArrayBlockWithOffset(name,999,0)));
            }
            catch(Exception e){System.out.println(name+" ERROR "+e.getMessage());}
        }
        reader.close();
    }
}
