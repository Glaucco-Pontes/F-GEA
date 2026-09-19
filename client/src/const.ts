import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const startLogin = () => {
  if (typeof window === "undefined") return;
  window.location.href = "/";
};
