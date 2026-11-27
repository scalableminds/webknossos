import java.net.URI;
import com.scalableminds.webknossos.datastore.helpers.S3UriUtils$;
// The actual Scala URI helper, with fixed region lookup outcomes supplied by the fixture.
public class GenerateS3UriFixtures {
    static String quote(String s) { return "\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\""; }
    public static void main(String[] args) throws Exception {
        var helper = S3UriUtils$.MODULE$;
        String[] paths = {"s3://bucket/a%20b/.zarray", "s3://bucket/arr?discard=1#fragment", "s3://bucket", "s3://bucket/a%252F", "s3://endpoint.example/bucket/key", "s3://bucket.s3.eu-west-1.amazonaws.com/key", "s3://localhost:9000/bucket/key", "https://host/key"};
        var out = new StringBuilder("[\n"); boolean first = true;
        for (String path : paths) for (String region : new String[]{null,"eu-central-1"}) {
            var uri = new URI(path);
            String expected = helper.isShortStyle(uri) ? helper.withEndpointHost(uri,helper.awsEndpointHost(scala.Option.apply(region))) : path;
            if (!first) out.append(",\n"); first = false;
            out.append("{\"path\":").append(quote(path)).append(",\"region\":").append(region==null?"null":quote(region)).append(",\"expected\":").append(quote(expected)).append("}");
        }
        System.out.println(out.append("\n]"));
    }
}
