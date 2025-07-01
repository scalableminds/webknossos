import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { deleteOrganization } from "admin/rest_api";
import { Button, Typography } from "antd";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { useState } from "react";
import type { APIOrganization } from "types/api_types";

export function OrganizationDangerZoneView({ organization }: { organization: APIOrganization }) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDeleteButtonClicked(): Promise<void> {
    const isDeleteConfirmed = await confirmAsync({
      title: "Danger Zone",
      content: (
        <div>
          <Typography.Title level={4} type="danger">
            You will lose access to all the datasets and annotations uploaded/created as part of
            this organization!
          </Typography.Title>
          <Typography.Title level={4} type="danger">
            Unless you are part of another WEBKNOSSOS organization, you can NOT login again with
            this account and will lose access to WEBKNOSSOS.
          </Typography.Title>
          <p>
            Deleting an organization{" "}
            <Typography.Text type="danger">cannot be undone</Typography.Text>. Are you certain you
            want to delete the organization {organization.name}?
          </p>
        </div>
      ),
      okText: <>Yes, delete this organization now and log me out.</>,
      okType: "danger",
      width: 500,
    });

    if (isDeleteConfirmed) {
      setIsDeleting(true);
      await deleteOrganization(organization.id);
      setIsDeleting(false);
      window.location.replace(`${window.location.origin}`);
    }
  }
  return (
    <>
      <SettingsTitle
        title="Delete Organization"
        description="Delete this organization including all annotations, uploaded datasets, and associated
            user accounts. Careful, this action can NOT be undone."
      />
      <SettingsCard
        title="Danger Zone"
        description={
          <Button
            danger
            loading={isDeleting}
            onClick={handleDeleteButtonClicked}
            style={{ marginTop: 10 }}
          >
            Delete Organization
          </Button>
        }
      />
    </>
  );
}
