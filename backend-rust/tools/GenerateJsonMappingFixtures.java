import java.nio.file.*;
import java.util.*;
import com.scalableminds.webknossos.datastore.services.mapping.MappingParser;
import com.scalableminds.util.box.Full;
import com.scalableminds.webknossos.datastore.models.datasource.DataLayerMapping;
import scala.runtime.AbstractFunction1;
public class GenerateJsonMappingFixtures {
    public static void main(String[] args)throws Exception {
        var root=Path.of(args[0]);
        String input="{\"name\":\"actual Scala typed parsing\",\"ignored\":{\"complex\":[1,2]},\"classes\":[[],[17,\"-1\",257],[513,257,65537],[4294967297,\"2.0\",-1],[-9223372036854775808,9223372036854775807]]}";
        Files.writeString(root.resolve("mapping.json"),input+"\n");
        var widths=new ArrayList<String>();
        for(int width:new int[]{1,2,4,8}) {
            var fn=new AbstractFunction1<Object,Object>() {public Object apply(Object o){long v=((Number)o).longValue();switch(width){case 1:return (byte)v;case 2:return (short)v;case 4:return (int)v;default:return v;}}};
            var box=MappingParser.parse(input.getBytes(java.nio.charset.StandardCharsets.UTF_8),fn);
            if(!(box instanceof Full))throw new RuntimeException(box.toString());
            var mapping=((DataLayerMapping<Object>)((Full)box).value()).mapping();
            var iterator=mapping.iterator();var entries=new TreeMap<String,String>();
            while(iterator.hasNext()) {var entry=iterator.next();long k=((Number)entry._1()).longValue(),v=((Number)entry._2()).longValue();if(width<8){long mask=(1L<<(width*8))-1;k&=mask;v&=mask;}entries.put(Long.toUnsignedString(k),Long.toUnsignedString(v));}
            var fields=new ArrayList<String>();for(var e:entries.entrySet())fields.add("\""+e.getKey()+"\":\""+e.getValue()+"\"");
            widths.add("\""+width+"\":{"+String.join(",",fields)+"}");
        }
        Files.writeString(root.resolve("mapping_oracle.json"),"{"+String.join(",",widths)+"}\n");
    }
}
