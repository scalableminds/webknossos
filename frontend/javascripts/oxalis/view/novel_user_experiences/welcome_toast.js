// @flow
import React, { useEffect } from "react";
import { Button, notification } from "antd";
import { useSelector } from "react-redux";
import features from "features";

function showWelcomeToast() {
  notification.open({
    message: (
      <div>
        <span className="logo" />
        Welcome to webKnossos!
      </div>
    ),
    description: (
      <div>
        You are viewing this dataset on webKnossos. webKnossos is an online tool to visualise and
        collaboratively annotate large image datasets. Try out the annotation features on the public
        dataset below. If this is for you, sign up for free, upload your data and get started!
        <div style={{ marginTop: 12, marginLeft: 200 }}>
          <Button
            type="primary"
            href="/auth/signup"
            target="_blank"
            rel="noopener noreferrer"
            style={{ background: "#256ff7" }}
          >
            Create a free account
          </Button>
          <Button
            type="default"
            href="https://webknossos.org/features"
            target="_blank"
            rel="noopener noreferrer"
            style={{ borderColor: "#eaeaea", marginLeft: 12 }}
          >
            Learn More
          </Button>
        </div>
      </div>
    ),
    className: "webknossos-welcome-toast",

    style: {
      width: 600,
    },
    duration: 0,
  });
}

export default function WelcomeToast() {
  const activeUser = useSelector(state => state.activeUser);

  useEffect(() => {
    // if (features().isDemoInstance) {
    //   return;
    // }
    const hasSeenToast = localStorage.getItem("novelUserExperienceInfos.hasSeenWelcomeToast");

    if (activeUser == null && hasSeenToast == null) {
      // Only if the user is not logged in and has never seen the toast before, we show it here.
      showWelcomeToast();
    }

    // Even if the toast wasn't opened above, we set the hasSeen bit, since the decision to not
    // show the toast will still be valid (and important) in the future. For example, the toast
    // should also *not* appear after a registered user logs out.
    localStorage.setItem("novelUserExperienceInfos.hasSeenWelcomeToast", "true");
  }, []);

  return null;
}
