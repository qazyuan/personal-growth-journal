import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "@supabase/supabase-js";
import { sessionNeedsRefresh } from "../lib/supabase-browser";
import { isRetryableAuthFailure } from "../lib/supabase-server";

function session(expiresAt?: number): Session {
  return {
    access_token: "access",
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: {} as Session["user"],
  };
}

test("refreshes a session before it expires", () => {
  const now = 2_000_000_000_000;
  assert.equal(sessionNeedsRefresh(session(now / 1000 + 30), now), true);
  assert.equal(sessionNeedsRefresh(session(now / 1000 + 120), now), false);
});

test("keeps sessions without an expiry timestamp", () => {
  assert.equal(sessionNeedsRefresh(session()), false);
});

test("distinguishes a temporary Supabase connection failure from an expired login", () => {
  assert.equal(isRetryableAuthFailure({ name: "AuthRetryableFetchError", status: 0 }), true);
  assert.equal(isRetryableAuthFailure({ name: "AuthApiError", status: 401 }), false);
});
