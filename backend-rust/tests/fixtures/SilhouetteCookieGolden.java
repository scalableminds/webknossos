import java.time.ZonedDateTime;
import java.util.concurrent.TimeUnit;
import scala.Option;
import scala.concurrent.duration.FiniteDuration;
import play.silhouette.api.LoginInfo;
import play.silhouette.api.crypto.Base64AuthenticatorEncoder;
import play.silhouette.api.crypto.Hash$;
import play.silhouette.crypto.JcaSigner;
import play.silhouette.crypto.JcaSignerSettings;
import play.silhouette.impl.authenticators.CookieAuthenticator;
import play.silhouette.impl.authenticators.CookieAuthenticator$;

public class WebknossosCookieGolden {
  public static void main(String[] args) {
    String fingerprint = Hash$.MODULE$.sha1("Golden Browser/1.0:en-US,en;q=0.9:utf-8:");
    CookieAuthenticator cookie = CookieAuthenticator$.MODULE$.apply(
      "AAAAAAAAAAAAAAAAAAAAAA", new LoginInfo("credentials", "000000000000000000000001"),
      ZonedDateTime.parse("2026-10-09T00:00:00.123Z[UTC]"),
      ZonedDateTime.parse("2026-11-08T00:00:00.123Z[UTC]"),
      Option.empty(), Option.apply(new FiniteDuration(365L * 86400, TimeUnit.SECONDS)), Option.apply(fingerprint));
    JcaSigner signer = new JcaSigner(new JcaSignerSettings("webknossos-golden-vector-secret", "-mohiva-silhouette-signer-"));
    Base64AuthenticatorEncoder encoder = new Base64AuthenticatorEncoder();
    System.out.println(CookieAuthenticator$.MODULE$.serialize(cookie, signer, encoder));
    System.out.println(CookieAuthenticator$.MODULE$.jsonFormat().writes(cookie));
    System.out.println(fingerprint);
    System.out.println(Hash$.MODULE$.sha1(":::"));
    if (args.length > 0) {
      System.out.println(CookieAuthenticator$.MODULE$.unserialize(args[0], signer, encoder));
    }
  }
}
