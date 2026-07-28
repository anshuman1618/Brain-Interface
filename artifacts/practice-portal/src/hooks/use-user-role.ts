import { useUser } from "@clerk/react";
import { UserProfileRole } from "@workspace/api-client-react";

export function useUserRole() {
  const { user, isLoaded, isSignedIn } = useUser();

  if (!isLoaded || !isSignedIn) {
    return {
      role: null,
      isLoaded,
      isSignedIn,
      user,
      isAdmin: false,
      isSenior: false,
      isJunior: false,
      isClerk: false,
      isClient: false,
      isStaff: false,
      displayRole: ""
    };
  }

  let role = (user.publicMetadata.role as string | undefined) || "client";
  
  if (role === "clerk") {
    role = "clerk_intern";
  }

  const isAdmin = role === "admin" || role === "senior_advocate";
  const isSenior = role === "senior_advocate";
  const isJunior = role === "junior_advocate";
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
    isAdmin,
    isSenior,
    isJunior,
    isClerk,
    isClient,
    isStaff,
    displayRole,
    isLoaded,
    isSignedIn,
    user,
  };
}
