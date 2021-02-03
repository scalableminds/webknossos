// @flow

import { Icon, Tooltip } from "antd";
import * as React from "react";
import { Link } from "react-router-dom";
import { isUserAdminOrTeamManager, isUserAdminOrDatasetManager } from "libs/utils";

import type { APIUser } from "types/api_flow_types";
import { getDemoDatasetUrl } from "features";
import renderIndependently from "libs/render_independently";

import { InviteUsersModal } from "admin/onboarding";

type WhatsNextActionProps = {
  title: string,
  description: string,
  icon: React.Node,
  onClick?: Function,
  href?: string,
  to?: string,
};

const WhatsNextAction = ({ title, description, icon, onClick, href, to }: WhatsNextActionProps) => {
  const content = (
    <React.Fragment>
      {icon}
      <div className="label">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <Icon type="right" className="chevron" />
    </React.Fragment>
  );

  if (to != null) {
    return <Link to={to}>{content}</Link>;
  }

  const linkProps =
    href != null
      ? {
          href,
          target: "_blank",
        }
      : {
          href: "#",
          onClick,
        };

  return <a {...linkProps}>{content}</a>;
};

type WhatsNextHeaderProps = {
  activeUser: APIUser,
  onDismiss: () => void,
};

export const WhatsNextHeader = ({ activeUser, onDismiss }: WhatsNextHeaderProps) => (
  <div>
    <div
      style={{
        backgroundColor: "rgba(88, 88, 88, 0.4)",
        backgroundImage: "linear-gradient(0deg, rgb(255 255 255) 0%, rgb(231 247 255) 70%)",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", right: 0, top: 0, margin: 8 }}>
        <Tooltip title="Don't show this again" placement="left">
          <Icon type="close" onClick={onDismiss} />
        </Tooltip>
      </div>
      <div className="welcome-header-content">
        <img className="wk-logo" src="/assets/images/oxalis.svg" alt="webKnossos Logo" />
        <div className="text-and-button-container">
          <h1
            style={{
              color: "#1F2937",
              marginLeft: 56,
              fontWeight: 200,
              fontSize: 64,
              lineHeight: "150%",
              marginBottom: 0,
            }}
          >
            Welcome to webKnossos!
          </h1>
          <div
            style={{
              margin: "0 20px 0px 60px",
              fontWeight: 300,
              fontSize: 20,
              lineHeight: "150%",
              color: "#6B7280",
            }}
          >
            <p
              style={{
                fontSize: 20,
                lineHeight: 1.5,
                marginTop: 0,
                marginBottom: 8,
              }}
            >
              Congratulations on your new webKnossos account! To hit the ground running, we
              recommend the following steps to you:
            </p>
            <div className="whats-next-actions-grid">
              <WhatsNextAction
                title="Open a Demo Dataset"
                description="Have a look at a public dataset to experience webKnossos in action."
                href={getDemoDatasetUrl()}
                icon={<Icon type="play-circle" className="action-icon" />}
              />

              {isUserAdminOrDatasetManager(activeUser) ? (
                <WhatsNextAction
                  title="Import Your Own Data"
                  description="Directly upload your data as a zip file."
                  to="/datasets/upload"
                  icon={<Icon type="cloud-upload" className="action-icon" />}
                />
              ) : null}

              <WhatsNextAction
                title="Learn How To Create Annotations"
                description="Watch a short video to see how data can be annotated with webKnossos."
                icon={<Icon type="plus-circle" className="action-icon" />}
                href="https://youtu.be/W-dosptovEU?t=52"
              />
              {isUserAdminOrTeamManager(activeUser) ? (
                <WhatsNextAction
                  title="Invite Your Colleagues"
                  description="Send invites to your colleagues and ask them to join your organization."
                  icon={<Icon type="mail" className="action-icon" />}
                  onClick={() => {
                    renderIndependently(destroy => (
                      <InviteUsersModal
                        organizationName={activeUser.organization}
                        destroy={destroy}
                      />
                    ));
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default {};
