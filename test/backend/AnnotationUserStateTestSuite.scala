package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.tracings.AnnotationUserStateUtils
import org.scalatestplus.play.PlaySpec

class AnnotationUserStateTestSuite extends PlaySpec with AnnotationUserStateUtils {

  private lazy val dummySkeletonWithUserState = Dummies.skeletonTracing.copy(
    userStates = Seq(
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userA",
        treeIds = Seq(1),
        treeVisibilities = Seq(false),
      ),
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userB",
        treeIds = Seq(1, 2),
        treeVisibilities = Seq(true, true),
      )
    )
  )

  "Skeleton user state" should {
    "be rendered into new skeleton user state correctly for userA" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userA", "userB")
      println(s"rendered: $renderedUserState")
      assert(renderedUserState.treeIds.length == 2)
      assert(renderedUserState.treeIds(0) == 1)
      assert(renderedUserState.treeVisibilities(0) == false)
      assert(renderedUserState.treeIds(1) == 2)
      assert(renderedUserState.treeVisibilities(1) == true)
    }
  }

  "be rendered into new skeleton user state correctly for userB (owner)" in {
    val renderedUserState =
      renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userB", "userB")
    assert(renderedUserState.treeIds.length == 2)
    assert(renderedUserState.treeIds(0) == 1)
    assert(renderedUserState.treeVisibilities(0) == true)
    assert(renderedUserState.treeIds(1) == 2)
    assert(renderedUserState.treeVisibilities(1) == true)
  }

}
