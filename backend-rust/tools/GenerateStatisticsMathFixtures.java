import java.util.Arrays;
import scala.jdk.javaapi.CollectionConverters;
import com.scalableminds.util.geometry.Vec3Int;
import com.scalableminds.webknossos.datastore.services.segmentstatistics.SegmentStatisticsMath$;

// Calls the existing compiled Scala implementation, rather than reimplementing its formulas.
public class GenerateStatisticsMathFixtures {
    public static void main(String[] args) {
        var math=SegmentStatisticsMath$.MODULE$;
        float[][] centers={{0.1f,0.2f,0.3f},{100.75f,-50.125f,4.25f},{2f,3f,-9.5f}};
        long[] volumes={3L,7L,11L};
        float[][][] matrices={{{2,.5f,.25f},{.5f,3,-.125f},{.25f,-.125f,4}},{{1,0,0},{0,1,0},{0,0,1}},{{3,1,2},{1,4,3},{2,3,5}}};
        var cs=CollectionConverters.asScala(Arrays.asList(centers)).toList();
        var vs=CollectionConverters.asScala(Arrays.<Object>asList(3L,7L,11L)).toList();
        var ms=CollectionConverters.asScala(Arrays.asList(matrices)).toList();
        var center=math.weightedCenterOfMass(cs,vs).get(()->"center oracle failed");
        var covariance=math.combineCovarianceMatrices(ms,cs,vs).get(()->"covariance oracle failed");
        System.out.println("{\"centers\":"+Arrays.deepToString(centers)+",\"volumes\":"+Arrays.toString(volumes)+",\"matrices\":"+Arrays.deepToString(matrices)+",\"center\":"+Arrays.toString(center)+",\"covariance\":"+Arrays.deepToString(covariance)+",\"rescale\":[");
        boolean first=true;
        for(long v:new long[]{0,1,125,Long.MAX_VALUE,Long.MIN_VALUE}) {
            if(!first)System.out.println(",");first=false;
            System.out.print("{\"volume\":\""+v+"\",\"file_mag\":[2,3,4],\"requested_mag\":[4,6,8],\"expected\":\""+math.rescaleVolumeToMag(v,new Vec3Int(2,3,4),new Vec3Int(4,6,8))+"\"}");
        }
        var zero=CollectionConverters.asScala(Arrays.<Object>asList(0L,0L,0L)).toList();
        System.out.println("],\"zero_center_fails\":"+math.weightedCenterOfMass(cs,zero).isEmpty()+",\"zero_covariance_fails\":"+math.combineCovarianceMatrices(ms,cs,zero).isEmpty()+"}");
    }
}
