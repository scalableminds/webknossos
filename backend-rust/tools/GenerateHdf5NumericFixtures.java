import java.nio.file.*;
import java.util.*;
import ch.systemsx.cisd.hdf5.HDF5Factory;
// Actual JHDF5 transfer-property conversion policy (stricter than H5Dread/H5P_DEFAULT).
public class GenerateHdf5NumericFixtures {
    public static void main(String[] args)throws Exception {
        var reader=HDF5Factory.openForReading(args[0]);var cases=new ArrayList<String>();
        var names=new ArrayList<String>();for(int width:new int[]{1,2,4,8}) {names.add("signed_"+width);names.add("unsigned_"+width);}names.add("float32");names.add("float64");
        for(String name:names)for(String target:new String[]{"uint64","float32"}) {
            String prefix="{\"name\":\""+name+"\",\"target\":\""+target+"\"";
            try {
                var values=new ArrayList<String>();
                if(target.equals("uint64"))for(long v:reader.uint64().readArrayBlockWithOffset(name,999,0))values.add("\""+Long.toUnsignedString(v)+"\"");
                else for(float v:reader.float32().readArrayBlockWithOffset(name,999,0))values.add(Float.toString(v));
                cases.add(prefix+",\"ok\":true,\"values\":["+String.join(",",values)+"]}");
            }catch(Exception error) {cases.add(prefix+",\"ok\":false}");}
        }
        reader.close();Files.writeString(Path.of(args[1]),"["+String.join(",",cases)+"]\n");
    }
}
