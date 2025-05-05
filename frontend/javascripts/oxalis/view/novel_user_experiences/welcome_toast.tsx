import { App, Button } from "antd";
import type { NotificationInstance } from "antd/es/notification/interface";
import features from "features";
import { useEffectOnlyOnce } from "libs/react_hooks";
import UserLocalStorage from "libs/user_local_storage";
import { useWkSelector } from "oxalis/store";

function showWelcomeToast(notification: NotificationInstance) {
  notification.open({
    className: "webknossos-welcome-toast",
    duration: 0,
    placement: "bottomRight",
    icon: <i className="logo" />,
    message: "Welcome to WEBKNOSSOS",
    description: (
      <div>
        <p>
          WEBKNOSSOS is a web-based platform for visualization, annotation, and sharing of
          large-scale 3D image datasets.
        </p>
        <p>Try out the annotation features and upload your own data with a free account.</p>
        <div>
          <Button type="default" href="/auth/signup" target="_blank" rel="noopener noreferrer">
            Create a free account
          </Button>
          <span className="drawing-welcome-guy">
            <Button
              ghost
              type="default"
              href="https://webknossos.org/features"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                marginLeft: 12,
              }}
            >
              Learn More
            </Button>
          </span>
        </div>
      </div>
    ),
  });
}

export default function WelcomeToast() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const { notification } = App.useApp();

  useEffectOnlyOnce(() => {
    if (!features().isWkorgInstance) {
      return;
    }
    const hasSeenToast = UserLocalStorage.getItem(
      "novelUserExperienceInfos.hasSeenWelcomeToast",
      false,
    );

    if (activeUser == null && hasSeenToast == null) {
      // Only if the user is not logged in and has never seen the toast before, we show it here.
      showWelcomeToast(notification);
    }

    // Even if the toast wasn't opened above, we set the hasSeen bit, since the decision to not
    // show the toast will still be valid (and important) in the future. For example, the toast
    // should also *not* appear after a registered user logs out.
    UserLocalStorage.setItem("novelUserExperienceInfos.hasSeenWelcomeToast", "true", false);
  });
  return null;
}
