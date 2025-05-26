package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.tracings.AnnotationUserStateUtils
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults
import org.scalatestplus.play.PlaySpec

class AnnotationUserStateTestSuite extends PlaySpec with AnnotationUserStateUtils {

  private lazy val dummySkeletonWithUserState = Dummies.skeletonTracing.copy(
    userStates = Seq(
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userA",
        treeIds = Seq(1),
        treeVisibilities = Seq(false),
        treeGroupIds = Seq(1),
        treeGroupExpandedStates = Seq(true),
        activeNodeId = Some(5)
      ),
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userB",
        treeIds = Seq(1, 2),
        treeVisibilities = Seq(true, true),
        treeGroupIds = Seq.empty,
        treeGroupExpandedStates = Seq.empty,
        activeNodeId = Some(2)
      )
    )
  )

  "Skeleton user state" should {
    "be rendered into new skeleton user state correctly for userA (sparse user state present for them)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userA", "userB")
      assert(renderedUserState.treeIds == Seq(1, 2))
      assert(renderedUserState.treeVisibilities == Seq(false, true))
      assert(renderedUserState.activeNodeId == Some(5))
      assert(renderedUserState.treeGroupIds == Seq(1))
      assert(renderedUserState.treeGroupExpandedStates == Seq(true))
    }

    "be rendered into new skeleton user state correctly for userB (owner)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userB", "userB")
      assert(renderedUserState.treeIds == Seq(1, 2))
      assert(renderedUserState.treeVisibilities == Seq(true, true))
      assert(renderedUserState.activeNodeId == Some(2))
      assert(renderedUserState.treeGroupIds == Seq.empty)
      assert(renderedUserState.treeGroupExpandedStates == Seq.empty)
    }

    "be rendered into new skeleton user state correctly for userC (no user state present for them)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userC", "userB")
      assert(renderedUserState.treeIds == Seq(1, 2))
      assert(renderedUserState.treeVisibilities == Seq(true, true))
      assert(renderedUserState.activeNodeId == Some(2))
      assert(renderedUserState.treeGroupIds == Seq.empty)
      assert(renderedUserState.treeGroupExpandedStates == Seq.empty)
    }

  }

  "volume user states merging" should {
    "respect id mapping" in {
      val tracingAUserStates = Seq(
        VolumeTracingDefaults
          .emptyUserState("userA")
          .copy(
            segmentIds = Seq(1),
            segmentVisibilities = Seq(true),
            segmentGroupIds = Seq(1),
            segmentGroupExpandedStates = Seq(true)
          ))
      val tracingBUserStates = Seq(
        VolumeTracingDefaults
          .emptyUserState("userA")
          .copy(
            segmentIds = Seq(1),
            segmentVisibilities = Seq(false),
            segmentGroupIds = Seq(1),
            segmentGroupExpandedStates = Seq(false)
          ))

      val segmentIdMapB = Map((1L, 2L))
      val mergedUserStates = mergeVolumeUserStates(tracingAUserStates,
                                                   tracingBUserStates,
                                                   groupMappingA = (groupId: Int) => groupId + 5,
                                                   segmentIdMapB,
                                                   Map.empty,
                                                   Map.empty)
      assert(
        mergedUserStates == Seq(
          VolumeTracingDefaults
            .emptyUserState("userA")
            .copy(
              segmentIds = Seq(1L, 2L),
              segmentVisibilities = Seq(true, false),
              segmentGroupIds = Seq(6, 1),
              segmentGroupExpandedStates = Seq(true, false),
            )))
    }
  }
}
