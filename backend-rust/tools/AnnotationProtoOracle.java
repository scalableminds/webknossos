// Test-fixture oracle: use the repository's compiled ScalaPB classes, not a
// second Rust implementation, to record acceptance of wire-format edge cases.
// Classpath: datastore classes + its sbt dependencyClasspath stream export.
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto$;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.HexFormat;

public class AnnotationProtoOracle {
    public static void main(String[] args) throws Exception {
        var reader = new BufferedReader(new InputStreamReader(System.in));
        for (String line; (line = reader.readLine()) != null;) {
            var fields = line.split("\t", -1);
            try {
                AnnotationProto$.MODULE$.parseFrom(HexFormat.of().parseHex(fields[1]));
                System.out.println(fields[0] + "\ttrue");
            } catch (Exception error) {
                if (!(error instanceof com.google.protobuf.InvalidProtocolBufferException)) throw error;
                System.out.println(fields[0] + "\tfalse");
            }
        }
    }
}
