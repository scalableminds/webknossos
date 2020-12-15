// @flow

import Store from "oxalis/store";

function prefixKey(key) {
  const { activeUser } = Store.getState();
  const prefix = !activeUser ? "Anonymous" : `${activeUser.email}-${activeUser.organization}`;
  return `${prefix}-${key}`;
}

const UserLocalStorage = {
  getItem(key: string): ?string {
    return localStorage.getItem(prefixKey(key));
  },

  setItem(key: string, value: string): void {
    return localStorage.setItem(prefixKey(key), value);
  },

  removeItem(key: string): void {
    return localStorage.removeItem(prefixKey(key));
  },

  clear(): void {
    localStorage.clear();
  },
};

export default UserLocalStorage;
