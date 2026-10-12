import at.favre.lib.crypto.bcrypt.BCrypt;
import java.nio.charset.StandardCharsets;
public class BcryptGolden {
  public static void main(String[] a) {
    String[] pws = {"secret", "Pässwörd-ünïcode 🔑", "a-much-longer-password-1234567890", "123456789012345678901234567890123456789012345678901234567890123456789012"};
    for (String pw : pws) {
      byte[] salt = new byte[16]; for (int i=0;i<16;i++) salt[i]=(byte)(i*7+3);
      String h = new String(BCrypt.withDefaults().hash(10, salt, pw.getBytes(StandardCharsets.UTF_8)), StandardCharsets.UTF_8);
      System.out.println(pw + "\t" + h + "\t" + BCrypt.verifyer().verify(pw.getBytes(StandardCharsets.UTF_8), h.getBytes(StandardCharsets.UTF_8)).verified);
    }
    try { BCrypt.withDefaults().hash(10, new byte[16], new byte[73]); System.out.println("73 ok"); } catch (Exception e) { System.out.println("73 rejected: " + e.getMessage()); }
    try { BCrypt.withDefaults().hash(10, new byte[16], new byte[71]); System.out.println("71 ok"); } catch (Exception e) { System.out.println("71 rejected: " + e.getMessage()); }
  }
}
