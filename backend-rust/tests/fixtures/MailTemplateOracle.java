import java.util.*;
import views.html.mail.*;

/** Renders Play's compiled Twirl mail templates (../target/scala-3.8.3/classes) for the Rust golden fixture. */
public class MailTemplateOracle {
  static final String NAME = "Jane <O'Brien> & \"Co\"";
  static final String URI = "https://wk.example/?a=1&b=2";
  static final String F = "<a href=\"https://imprint.example\">Imprint</a> &amp; more";
  static final String LINK = "https://wk.example/datasets/abc/view?token=x&y=1";
  static final String DS = "dataset <1> & 'two'";

  static void out(String name, play.twirl.api.Html html) {
    System.out.println(name + "\t" + Base64.getEncoder().encodeToString(html.body().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }

  public static void main(String[] args) {
    out("new_user_review", newUser$.MODULE$.apply(NAME, false, F));
    out("new_user_auto", newUser$.MODULE$.apply(NAME, true, F));
    out("register_admin_notifier_auto", notifyAdminNewUser$.MODULE$.apply(NAME, URI, true, F));
    out("register_admin_notifier_manual", notifyAdminNewUser$.MODULE$.apply(NAME, URI, false, F));
    out("over_limit", notifyAdminTimeLimit$.MODULE$.apply(NAME, "Proj <1>", "task&1", "ann'1", URI, F));
    out("activated", validateUser$.MODULE$.apply(NAME, URI, F));
    out("change_password", passwordChanged$.MODULE$.apply(NAME, URI, F));
    out("reset_password", resetPassword$.MODULE$.apply(NAME, URI, "tok&en", F));
    out("new_organization", notifyAdminNewOrganization$.MODULE$.apply("Org \"X\"", "creator@ex.test", "wk.example:9000", F));
    out("invite", invite$.MODULE$.apply(NAME, "Org <X>", "tok'1", URI, true, F));
    out("help", help$.MODULE$.apply(NAME, "Org & Co", "Help me\n<please>", URI, F));
    out("pricing_plan_expiry_reminder_1", pricingPlanExpiryReminder$.MODULE$.apply(NAME, "Org & Co", "Team", "2026-10-11", 1L, URI + "/organization/overview", F));
    out("pricing_plan_expiry_reminder_14", pricingPlanExpiryReminder$.MODULE$.apply(NAME, "Org & Co", "Team", "2026-10-11", 14L, URI + "/organization/overview", F));
    scala.collection.immutable.List<String> features = scala.jdk.javaapi.CollectionConverters.asScala(List.of("A & B", "C <D>")).toList();
    out("pricing_plan_upgraded", pricingPlanUpgraded$.MODULE$.apply(NAME, "Org & Co", "Power", features, URI, F));
    out("job_successful_generic", jobSuccessfulGeneric$.MODULE$.apply(NAME, DS, LINK, "Mesh Generation", "Your meshes & more are ready.", F));
    out("job_successful_upload_convert", jobSuccessfulUploadConvert$.MODULE$.apply(NAME, DS, LINK, F));
    out("job_successful_neuron_segmentation", jobSuccessfulNeuronSegmentation$.MODULE$.apply(NAME, DS, LINK, F));
    out("job_successful_mito_segmentation", jobSuccessfulMitoSegmentation$.MODULE$.apply(NAME, DS, LINK, F));
    out("job_successful_alignment", jobSuccessfulAlignment$.MODULE$.apply(NAME, DS, LINK, F));
    out("job_successful_model_training", jobSuccessfulModelTraining$.MODULE$.apply(NAME, LINK, F));
    out("email_verification_expiry", verifyEmail$.MODULE$.apply(NAME, LINK, "This link will expire in 30 days. ", F));
    out("email_verification_no_expiry", verifyEmail$.MODULE$.apply(NAME, LINK, "", F));
  }
}
