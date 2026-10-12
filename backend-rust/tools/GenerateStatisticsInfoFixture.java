import java.util.Arrays;
import scala.jdk.javaapi.CollectionConverters;
import com.scalableminds.util.geometry.Vec3Int;
import com.scalableminds.webknossos.datastore.services.segmentstatistics.SegmentStatisticsFileInfos$;

// Exact Play Json.format serialization from the compiled Scala controller DTO.
public class GenerateStatisticsInfoFixture {
    public static void main(String[] args) {
        var metrics=CollectionConverters.asScala(Arrays.asList("max_distances","volumes","center_of_mass","covariance_matrix","surfaces","sphericities")).toList();
        var companion=SegmentStatisticsFileInfos$.MODULE$;
        var info=companion.apply(new Vec3Int(2,1,1),metrics,scala.Option.empty());
        System.out.println(companion.derived$JsonAutoFormat().writes(info));
    }
}
