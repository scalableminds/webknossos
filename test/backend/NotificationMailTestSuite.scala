package backend

import com.scalableminds.util.objectid.ObjectId
import models.team.TeamMembership
import models.user.NotificationMailService.accessChanges
import models.user.User
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.Json

class NotificationMailTestSuite extends AsyncWordSpec {

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
      assert(
        accessChanges(
          List(TeamMembership(teamA, false)),
          List(TeamMembership(teamA, false)),
          user,
          user,
          teamNames
        ).isEmpty
      )
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
