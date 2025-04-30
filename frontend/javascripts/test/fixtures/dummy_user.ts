import type { APIUser } from "types/api_types";

const dummyUser: APIUser = {
  email: "dummy@email.com",
  firstName: "First Name",
  lastName: "Last Name",
  id: "dummy-user-id",
  isAnonymous: false,
  teams: [],
  isAdmin: false,
  isDatasetManager: false,
  isOrganizationOwner: true,
  created: 1,
  experiences: {},
  isSuperUser: false,
  isActive: true,
  isEditable: true,
  lastActivity: 1,
  lastTaskTypeId: null,
  organization: "sample_organization",
  novelUserExperienceInfos: {},
  selectedTheme: "auto",
  isEmailVerified: true,
};

export default dummyUser;
