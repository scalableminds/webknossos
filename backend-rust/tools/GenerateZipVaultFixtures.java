// Fixture-only calls into the actual compiled Scala ZipDataVault (no Play server).
import java.nio.file.*;
import java.util.*;
import scala.concurrent.Await$;
import scala.concurrent.ExecutionContext$;
import scala.concurrent.duration.Duration$;
import com.scalableminds.util.box.*;
import com.scalableminds.util.tools.Fox;
import com.scalableminds.util.accesscontext.TokenContext$;
import com.scalableminds.webknossos.datastore.datavault.*;
import com.scalableminds.webknossos.datastore.helpers.*;
public class GenerateZipVaultFixtures {
    static String quote(String s) { return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r")+"\""; }
    static Box result(Fox fox) throws Exception { return (Box)Await$.MODULE$.result(fox.futureBox(),Duration$.MODULE$.apply(30,"seconds")); }
    static final varHolder H = new varHolder();
    static class varHolder { final scala.concurrent.ExecutionContext ec=ExecutionContext$.MODULE$.global(); final com.scalableminds.util.accesscontext.TokenContext tc=TokenContext$.MODULE$.apply(scala.Option.empty()); }
    static String read(ZipDataVault vault,VaultPath path,ByteRange range) throws Exception {
        Box box;
        try { box=result(vault.readBytesPlusEncodingAndRangeHeader(path,range,H.ec,H.tc)); }
        catch(Exception error) { return "{\"exception\":"+quote(error.toString())+"}"; }
        if (box instanceof Full) {
            var tuple=(scala.Tuple3<byte[],scala.Enumeration.Value,scala.Option<String>>)((Full)box).value();
            return "{\"bytes\":"+quote(Base64.getEncoder().encodeToString(tuple._1()))+",\"encoding\":"+quote(tuple._2().toString())+",\"contentRange\":"+(tuple._3().isDefined()?quote(tuple._3().get()):"null")+"}";
        }
        return failure(box);
    }
    static String failure(Box box) { return box instanceof Failure ? "{\"error\":"+quote(((Failure)box).msg())+"}" : "{\"missing\":true}"; }
    static String list(ZipDataVault vault,VaultPath path,int max) throws Exception {
        var box=result(vault.listDirectory(path,max,H.ec,H.tc));
        if (!(box instanceof Full)) return failure(box);
        var names=new ArrayList<String>();
        var paths=(scala.collection.immutable.Seq<VaultPath>)((Full)box).value();
        for (var child:scala.jdk.javaapi.CollectionConverters.asJava(paths)) names.add(quote(((ZipEntryUPath)child.toUPath()).innerPath()));
        return "{\"names\":["+String.join(",",names)+"]}";
    }
    static String size(ZipDataVault vault,VaultPath path) throws Exception {
        var box=result(vault.getUsedStorageBytes(path,H.ec,H.tc));
        return box instanceof Full ? "{\"size\":"+((Full)box).value()+"}" : failure(box);
    }
    static void archive(Path file,List<String> cases) throws Exception {
        String name=file.getFileName().toString(); var outer=UPath$.MODULE$.fromLocalPath(file.toAbsolutePath());
        var vault=new ZipDataVault(new VaultPath(outer,new FileSystemDataVault()));
        for (var inner:new String[]{"","dir"}) for (int max:new int[]{0,1,2,4,10,100}) {
            var path=new VaultPath(new ZipEntryUPath(outer,inner),vault);
            cases.add("{\"archive\":"+quote(name)+",\"operation\":\"list\",\"inner\":"+quote(inner)+",\"max\":"+max+",\"expected\":"+list(vault,path,max)+"}");
        }
        for (var inner:new String[]{"","dir","a.bin","missing"}) {
            var path=new VaultPath(new ZipEntryUPath(outer,inner),vault);
            cases.add("{\"archive\":"+quote(name)+",\"operation\":\"size\",\"inner\":"+quote(inner)+",\"expected\":"+size(vault,path)+"}");
        }
        for (var inner:new String[]{"a.bin","b","dir/b.bin","empty","compressed","dup","missing"}) {
            var path=new VaultPath(new ZipEntryUPath(outer,inner),vault);
            String[] ranges={"complete","start3end17","suffix2","suffix100","start40end50","start5end2","start0end0"};
            for (String mode:ranges) {
                ByteRange range=switch(mode) { case "complete"->new CompleteByteRange(); case "start3end17"->new StartEndExclusiveByteRange(3,17);case "suffix2"->new SuffixLengthByteRange(2);case "suffix100"->new SuffixLengthByteRange(100);case "start40end50"->new StartEndExclusiveByteRange(40,50);case "start5end2"->new StartEndExclusiveByteRange(5,2);default->new StartEndExclusiveByteRange(0,0); };
                cases.add("{\"archive\":"+quote(name)+",\"operation\":\"read\",\"inner\":"+quote(inner)+",\"range\":"+quote(mode)+",\"expected\":"+read(vault,path,range)+"}");
            }
        }
    }
    public static void main(String[] args) throws Exception {
        var cases=new ArrayList<String>();
        try (var files=Files.list(Path.of(args[0]))) { for (var file:files.filter(p->p.toString().endsWith(".zip")).sorted().toList()) archive(file,cases); }
        if (args.length > 1) {
            var file=Path.of(args[1]);var outer=UPath$.MODULE$.fromLocalPath(file.toAbsolutePath());var vault=new ZipDataVault(new VaultPath(outer,new FileSystemDataVault()));var path=new VaultPath(new ZipEntryUPath(outer,"a.bin"),vault);
            cases.add("{\"archive\":\"sparse.zip\",\"operation\":\"size\",\"inner\":\"a.bin\",\"expected\":"+size(vault,path)+"}");
            cases.add("{\"archive\":\"sparse.zip\",\"operation\":\"read\",\"inner\":\"a.bin\",\"range\":\"start3end17\",\"expected\":"+read(vault,path,new StartEndExclusiveByteRange(3,17))+"}");
        }
        System.out.println("[\n"+String.join(",\n",cases)+"\n]");
    }
}
