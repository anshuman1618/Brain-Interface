import { useUser } from "@clerk/react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

// Role is sourced from the DB via /users/me (not Clerk's publicMetadata) so
// that an admin changing a user's role takes effect immediately, without
// waiting on a Clerk session token refresh.
export function useUserRole() {
  const { user, isLoaded: clerkLoaded, isSignedIn } = useUser();
  const { data: profile, isLoading: profileLoading } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: !!isSignedIn },
  });

  const isLoaded = clerkLoaded && (!isSignedIn || !profileLoading);

  if (!isLoaded || !isSignedIn || !profile) {
    return {
      role: null,
      roleSelected: false,
      isLoaded,
      isSignedIn,
      profile,
      user,
      isAdmin: false,
      isSenior: false,
      isJunior: false,
      isAdvocate: false,
      isClerk: false,
      isClient: false,
      isStaff: false,
      displayRole: ""
    };
  }

  let role = profile.role || "client";

  if (role === "clerk") {
    role = "clerk_intern";
  }

  // Admin is a distinct master-access role — it is NOT the same as senior_advocate.
  // Conflating them previously leaked Admin-only capabilities (KPI, Billing, Access
  // Control) to the Advocate tier, contradicting the RBAC matrix.
  const isAdmin = role === "admin";
  const isSenior = role === "senior_advocate";
  const isJunior = role === "junior_advocate";
  const isAdvocate = isSenior || isJunior;
  const isClerk = role === "clerk_intern";
  const isClient = role === "client";
  const isStaff = !isClient;

  let displayRole = "Client";
  if (role === "admin") displayRole = "Firm Admin";
  else if (role === "senior_advocate") displayRole = "Senior Advocate";
  else if (role === "junior_advocate") displayRole = "Junior Advocate";
  else if (role === "clerk_intern") displayRole = "Clerk / Intern";

  return {
    role,
    roleSelected: profile.roleSelected,
    isAdmin,
    isSenior,
    isJunior,
    isAdvocate,
    isClerk,
    isClient,
    isStaff,
    displayRole,
    isLoaded,
    isSignedIn,
    profile,
    user,
  };
}
