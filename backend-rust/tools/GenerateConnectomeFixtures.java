import java.nio.file.*;
import java.util.*;
import java.util.stream.*;
import scala.jdk.javaapi.CollectionConverters;
import scala.concurrent.Await$;
import scala.concurrent.duration.Duration$;
import com.scalableminds.util.box.*;
import com.scalableminds.util.tools.Fox;
import com.scalableminds.util.accesscontext.TokenContext$;
import com.scalableminds.webknossos.datastore.services.connectome.*;
import com.scalableminds.webknossos.datastore.models.datasource.*;
import com.scalableminds.webknossos.datastore.helpers.UPath$;
public class GenerateConnectomeFixtures {
    static class LocalVaultService extends com.scalableminds.webknossos.datastore.storage.DataVaultService {
        LocalVaultService(){super(null,null,null,null,null);}
        @Override public Fox<com.scalableminds.webknossos.datastore.datavault.VaultPath> vaultPathFor(LayerAttachment attachment,scala.concurrent.ExecutionContext ec) {
            return com.scalableminds.util.tools.Fox$.MODULE$.successful(new com.scalableminds.webknossos.datastore.datavault.VaultPath(attachment.path(),new com.scalableminds.webknossos.datastore.datavault.FileSystemDataVault()),ec);
        }
    }
    static Object result(Fox<?> fox)throws Exception {
        var box=Await$.MODULE$.result(fox.futureBox(),Duration$.MODULE$.apply(30,"seconds"));
        if(box instanceof Full)return ((Full<?>)box).value();
        throw new RuntimeException(box.toString());
    }
    static scala.collection.immutable.List<Object> ids(long...values) {
        return CollectionConverters.asScala(Arrays.stream(values).boxed().map(v->(Object)v).toList()).toList();
    }
    static String numbers(scala.collection.IterableOnce<?> values) {
        var out=new ArrayList<String>();var it=values.iterator();while(it.hasNext())out.add(it.next().toString());return "["+String.join(",",out)+"]";
    }
    public static void main(String[] args)throws Exception {
        var root=Path.of(args[0]);var hdf=new Hdf5ConnectomeFileService();var config=new com.scalableminds.webknossos.datastore.DataStoreConfig(new play.api.Configuration(com.typesafe.config.ConfigFactory.parseFile(new java.io.File("webknossos-datastore/conf/standalone-datastore.conf")).resolve()));
        var zarr=new ZarrConnectomeFileService(new LocalVaultService(),new com.scalableminds.webknossos.datastore.services.DSChunkCacheService(config));
        var service=new ConnectomeFileService(hdf,zarr);
        var ec=scala.concurrent.ExecutionContext$.MODULE$.global();var tc=TokenContext$.MODULE$.apply(scala.Option.empty());
        for(String format:new String[]{"contiguous.hdf5","zarr3","numeric.hdf5","zarr_numeric"}) {
        var attachment=LayerAttachment$.MODULE$.apply("native",UPath$.MODULE$.fromStringUnsafe(root.resolve(format).toAbsolutePath().toString()),!format.endsWith(".hdf5")?LayerAttachmentDataformat$.MODULE$.zarr3():LayerAttachmentDataformat$.MODULE$.hdf5(),scala.Option.empty());
        var key=ConnectomeFileKey.apply(DataSourceId.apply("ds","org"),"seg",attachment);
        var queries=new ArrayList<String>();
        long[][] sets={{},{0},{1},{2},{7},{4,2},{4,2,4},{2,2},{0,1,2,3,4,5,6},{6,5,4,3,2,1,0}};
        for(var values:sets) {
            if(format.equals("zarr_numeric") && values.length>1)continue;
            var v=(scala.collection.immutable.Seq<DirectedSynapseList>)result(service.synapsesForAgglomerates(key,ids(values),ec,tc));
            var rows=new ArrayList<String>();var it=v.iterator();while(it.hasNext())rows.add(DirectedSynapseList$.MODULE$.derived$JsonAutoFormat().writes(it.next()).toString());
            queries.add("{\"ids\":"+Arrays.toString(values)+",\"value\":["+String.join(",",rows)+"]}");
        }
        var fields=new ArrayList<String>();fields.add("\"synapses\":["+String.join(",",queries)+"]");
        var reader=ch.systemsx.cisd.hdf5.HDF5Factory.openForReading(root.resolve("contiguous.hdf5").toString());
        int last=reader.uint64().readArray("synapse_types").length-1;reader.close();var selected=ids(last,0,2,2);
        var pos=(scala.collection.immutable.Seq<scala.collection.immutable.Seq<Object>>)result(service.positionsForSynapses(key,selected,ec,tc));
        var rows=new ArrayList<String>();var it=pos.iterator();while(it.hasNext())rows.add(numbers(it.next()));
        fields.add("\"selected\":"+numbers(selected));fields.add("\"positions\":["+String.join(",",rows)+"]");
        var types=(SynapseTypesWithLegend)result(service.typesForSynapses(key,selected,ec,tc));fields.add("\"types\":"+SynapseTypesWithLegend$.MODULE$.derived$JsonAutoFormat().writes(types));
        for(var dir:List.of(SynapticPartnerDirection$.MODULE$.src(),SynapticPartnerDirection$.MODULE$.dst())) {
            var partners=(scala.collection.immutable.List<Object>)result(service.synapticPartnerForSynapses(key,selected,dir,ec,tc));fields.add("\""+dir+"\":"+numbers(partners));
        }
        var boundaries=new ArrayList<String>();
        for(long id:new long[]{-1,last+1,1000}) {
            try {
                var value=(scala.collection.immutable.List<Object>)result(service.synapticPartnerForSynapses(key,ids(id),SynapticPartnerDirection$.MODULE$.dst(),ec,tc));
                boundaries.add("{\"id\":"+id+",\"ok\":true,\"value\":"+numbers(value)+"}");
            } catch(Exception error) {boundaries.add("{\"id\":"+id+",\"ok\":false}");}
        }
        fields.add("\"boundaries\":["+String.join(",",boundaries)+"]");
        Files.writeString(root.resolve("scala_"+(format.equals("contiguous.hdf5")?"oracle":format.equals("zarr3")?"zarr_oracle":format.equals("numeric.hdf5")?"numeric_oracle":"zarr_numeric_oracle")+".json"),"{"+String.join(",",fields)+"}\n");
        }
        var orders=new ArrayList<String>();
        long[][] samples={{},{7,8,7},{4,3,2,1},{0,1,2,3,4},{6,5,4,3,2,1,0},{1,33,65,97,129,161},{Long.MIN_VALUE,Long.MAX_VALUE,-1,0,1,4294967296L,4294967297L},{1,4294967296L,8589934595L,3,2,4,5}};
        for(var values:samples)orders.add("{\"ids\":"+Arrays.toString(values)+",\"order\":"+numbers(ids(values).toSet().toSeq())+"}");
        for(int size=0;size<=128;size++) {var values=new long[size];for(int j=0;j<size;j++)values[j]=j;orders.add("{\"ids\":"+Arrays.toString(values)+",\"order\":"+numbers(ids(values).toSet().toSeq())+"}");}
        Files.writeString(root.resolve("set_order_oracle.json"),"["+String.join(",",orders)+"]\n");hdf.clearCache(DataSourceId.apply("ds","org"),scala.Option.empty());zarr.clearCache(DataSourceId.apply("ds","org"),scala.Option.empty());
    }
}
