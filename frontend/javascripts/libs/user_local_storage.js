// @flow

import Store from "oxalis/store";

function prefixKey(key, isOrganizationSpecific) {
  const { activeUser } = Store.getState();

  let prefix;
  if (!activeUser) {
    prefix = "Anonymous";
  } else if (isOrganizationSpecific) {
    prefix = `${activeUser.email}-${activeUser.organization}`;
  } else {
    prefix = activeUser.email;
  }

  return `${prefix}-${key}`;
}

const UserLocalStorage = {
  getItem(key: string, isOrganizationSpecific: boolean = true): ?string {
    return localStorage.getItem(prefixKey(key, isOrganizationSpecific));
  },

  setItem(key: string, value: string, isOrganizationSpecific: boolean = true): void {
    return localStorage.setItem(prefixKey(key, isOrganizationSpecific), value);
  },

  removeItem(key: string, isOrganizationSpecific: boolean = true): void {
    return localStorage.removeItem(prefixKey(key, isOrganizationSpecific));
  },

  clear(): void {
    localStorage.clear();
  },
};

export default UserLocalStorage;
