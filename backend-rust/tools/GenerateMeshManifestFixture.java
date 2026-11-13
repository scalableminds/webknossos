import java.nio.file.Files;
import java.nio.file.Path;
import com.scalableminds.webknossos.datastore.services.mesh.*;

// Exact manifest/enrichment/JSON from the actual compiled Scala implementations.
public class GenerateMeshManifestFixture {
    public static void main(String[] args) throws Exception {
        var manifest=NeuroglancerSegmentManifest$.MODULE$.fromBytes(Files.readAllBytes(Path.of(args[0])));
        double[][] transform={{2,.5,1,10},{.25,3,.75,20},{1,.5,4,30}};
        double multiplier=.75;
        if(args[4].equals("real")){transform=new double[][]{{1,0,0,0},{0,1,0,0},{0,0,1,0}};multiplier=1;}
        long offset=Long.parseLong(args[1]),id=Long.parseLong(args[2]);
        var helper=args[3].equals("precomputed") ? new NeuroglancerPrecomputedMeshFileService(null,null) : new Hdf5MeshFileService();
        // Both classes implement the same enrichment interface, with different transforms.
        var infos=((NeuroglancerMeshHelper)helper).enrichSegmentInfo(manifest,multiplier,transform,offset,id);
        double scale=args[3].equals("precomputed") ? 1./1024 : 1.;
        var value=WebknossosSegmentInfo$.MODULE$.apply("draco",infos,new double[]{scale,scale,scale});
        System.out.println(WebknossosSegmentInfo$.MODULE$.derived$JsonAutoFormat().writes(value));
    }
}
