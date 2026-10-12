// Fixture-only oracle using the same AWS SDK version as project/Dependencies.scala.
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.io.ByteArrayInputStream;
import java.util.*;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.signer.AwsS3V4Signer;
import software.amazon.awssdk.auth.signer.params.AwsS3V4SignerParams;
import software.amazon.awssdk.http.*;
import software.amazon.awssdk.regions.Region;

public class GenerateS3UploadSigningFixtures {
    static String quote(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }
    public static void main(String[] args) {
        String[] methods = {"PUT", "PUT", "POST", "DELETE"};
        String[] payloads = {"small object", "multipart bytes", "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;tag&quot;</ETag></Part></CompleteMultipartUpload>", ""};
        StringBuilder json = new StringBuilder("[\n");
        for (int i = 0; i < methods.length; i++) {
            byte[] body = payloads[i].getBytes(StandardCharsets.UTF_8);
            var builder = SdkHttpFullRequest.builder().method(SdkHttpMethod.valueOf(methods[i]))
                .uri(URI.create("https://storage.example.test:9443/bucket/key%20space"))
                .contentStreamProvider(() -> new ByteArrayInputStream(body));
            if (i != 3) builder.putHeader("content-length", Integer.toString(body.length)).putHeader("content-type", i == 2 ? "application/xml" : "application/octet-stream");
            if (i > 0) builder.putRawQueryParameter("uploadId", "id+/&=");
            if (i == 1) builder.putRawQueryParameter("partNumber", "1");
            var params = AwsS3V4SignerParams.builder().awsCredentials(AwsSessionCredentials.create("example-key", "example-secret", "example-session"))
                .signingRegion(Region.EU_CENTRAL_1).signingName("s3").enablePayloadSigning(true).enableChunkedEncoding(false)
                .doubleUrlEncode(false).normalizePath(false).signingClockOverride(Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC)).build();
            var signed = AwsS3V4Signer.create().sign(builder.build(), params);
            if (i != 0) json.append(",\n");
            json.append("{\"method\":").append(quote(methods[i])).append(",\"path\":").append(quote(signed.encodedPath())).append(",\"payload\":").append(quote(payloads[i])).append(",\"query\":[");
            boolean first = true;
            for (var entry : signed.rawQueryParameters().entrySet()) for (var value : entry.getValue()) {
                if (!first) json.append(','); first = false;
                json.append('[').append(quote(entry.getKey())).append(',').append(quote(value)).append(']');
            }
            json.append("],\"headers\":{"); first = true;
            for (var entry : signed.headers().entrySet()) {
                if (!first) json.append(','); first = false;
                json.append(quote(entry.getKey().toLowerCase(Locale.ROOT))).append(':').append(quote(String.join(",", entry.getValue())));
            }
            json.append("}}");
        }
        System.out.println(json.append("\n]"));
    }
}
