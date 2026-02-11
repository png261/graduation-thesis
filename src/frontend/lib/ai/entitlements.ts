import type { UserType } from "@/app/(auth)/auth";

type Entitlements = {
  maxMessagesPerDay: number;
};

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account
   */
  guest: {
    maxMessagesPerDay: Number.MAX_SAFE_INTEGER,
  },

  /*
   * For users with an account
   */
  regular: {
    maxMessagesPerDay: Number.MAX_SAFE_INTEGER,
  },

  /*
   * TODO: For users with an account and a paid membership
   */
};
