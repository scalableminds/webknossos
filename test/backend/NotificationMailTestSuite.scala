package backend

import com.scalableminds.util.objectid.ObjectId
import models.storage.StorageWarningService.{crossedThresholdsPercent, rearmedThresholdsPercent, usagePercent}
import models.team.TeamMembership
import models.user.NotificationMailService.accessChanges
import models.user.User
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.Json

class NotificationMailTestSuite extends AsyncWordSpec {

  private val thresholdsPercent = List(90, 100)

  "usagePercent" should {
    "relate the used to the included storage" in {
      assert(usagePercent(45, 100) == 45.0)
      assert(usagePercent(150, 100) == 150.0)
    }
    // Organizations without included storage cannot upload anything, so any usage counts as exceeded.
    "treat any usage as exceeded if no storage is included" in {
      assert(usagePercent(0, 0) == 0.0)
      assert(usagePercent(1, 0).isPosInfinity)
    }
  }

  "crossedThresholdsPercent" should {
    "be empty below the lowest threshold" in
      assert(crossedThresholdsPercent(89.9, thresholdsPercent).isEmpty)
    "contain all thresholds that were reached" in {
      assert(crossedThresholdsPercent(90, thresholdsPercent) == List(90))
      assert(crossedThresholdsPercent(100, thresholdsPercent) == List(90, 100))
      assert(crossedThresholdsPercent(Double.PositiveInfinity, thresholdsPercent) == List(90, 100))
    }
  }

  "rearmedThresholdsPercent" should {
    // Without a margin, usage hovering around a threshold would trigger a new mail on every storage scan.
    "keep thresholds armed while the usage is only slightly below them" in {
      assert(rearmedThresholdsPercent(86, thresholdsPercent) == List(100))
      assert(rearmedThresholdsPercent(96, thresholdsPercent).isEmpty)
    }
    "re-arm thresholds once the usage dropped clearly below them" in {
      assert(rearmedThresholdsPercent(84.9, thresholdsPercent) == List(90, 100))
      assert(rearmedThresholdsPercent(94, thresholdsPercent) == List(100))
    }
    "never re-arm a threshold that is currently crossed" in
      assert(rearmedThresholdsPercent(120, thresholdsPercent).isEmpty)
  }

  "accessChanges" should {
    val teamA = ObjectId.generate
    val teamB = ObjectId.generate
    val teamNames = Map(teamA -> "Team A", teamB -> "Team B")
    val user = User(
      ObjectId.generate,
      ObjectId.generate,
      "organization",
      userConfiguration = Json.obj(),
      isAdmin = false,
      isOrganizationOwner = false,
      isDatasetManager = false,
      isDeactivated = false,
      isUnlisted = false
    )

    "be empty if nothing changed" in
      assert(accessChanges(List(TeamMembership(teamA, false)), List(TeamMembership(teamA, false)), user, user, teamNames).isEmpty)
    "describe added and removed teams" in
      assert(
        accessChanges(List(TeamMembership(teamA, false)), List(TeamMembership(teamB, true)), user, user, teamNames) ==
          List("You were added to the team Team B as team manager.", "You were removed from the team Team A.")
      )
    "describe team manager changes" in {
      assert(
        accessChanges(List(TeamMembership(teamA, false)), List(TeamMembership(teamA, true)), user, user, teamNames) ==
          List("You are now a team manager of the team Team A.")
      )
      assert(
        accessChanges(List(TeamMembership(teamA, true)), List(TeamMembership(teamA, false)), user, user, teamNames) ==
          List("You are no longer a team manager of the team Team A.")
      )
    }
    "describe role changes before team changes" in
      assert(
        accessChanges(
          List.empty,
          List(TeamMembership(teamA, false)),
          user,
          user.copy(isAdmin = true, isDatasetManager = true),
          teamNames
        ) == List(
          "You are now an admin of the organization.",
          "You are now a dataset manager.",
          "You were added to the team Team A."
        )
      )
  }

  "the storage warning mail" should {
    def render(usagePercent: Long, isExceeded: Boolean) =
      views.html.mail
        .storageWarning(
          "Sample User",
          "Sample Organization",
          "92.0 GB",
          "100.0 GB",
          usagePercent,
          isExceeded,
          "http://localhost:9000/organization/overview",
          ""
        )
        .body

    "announce the upcoming limit before it is reached" in {
      val body = render(92, isExceeded = false)
      assert(body.contains("is running out of storage"))
      assert(body.contains("(92%)"))
      assert(body.contains("http://localhost:9000/organization/overview"))
    }
    "announce blocked uploads once the limit is reached" in {
      val body = render(100, isExceeded = true)
      assert(body.contains("has used up its included storage"))
      assert(body.contains("are blocked"))
    }
  }

  "the annotation shared mail" should {
    def render(teamNames: List[String]) =
      views.html.mail
        .annotationShared(
          "Sample User",
          "Other <b>User</b>",
          "My Annotation",
          "My Dataset",
          teamNames,
          "http://localhost:9000/annotations/abc",
          ""
        )
        .body

    "list the teams it was shared with" in {
      assert(render(List("Team A")).contains("your team <i>Team A</i>"))
      assert(render(List("Team A", "Team B")).contains("your teams <i>Team A, Team B</i>"))
    }
    // Names are chosen by users, so they must not be able to inject HTML into mails sent to others.
    "escape user-provided names" in
      assert(render(List("Team A")).contains("Other &lt;b&gt;User&lt;/b&gt;"))
  }
}
