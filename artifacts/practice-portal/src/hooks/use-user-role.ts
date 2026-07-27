import { useUser } from "@clerk/react";
import { UserProfileRole } from "@workspace/api-client-react";

export function useUserRole() {
  const { user, isLoaded, isSignedIn } = useUser();

  if (!isLoaded || !isSignedIn) {
    return { role: null, isLoaded, isSignedIn, user };
  }

  const role = user.publicMetadata.role as UserProfileRole | undefined;

  return {
    role: role || 'client', // Default to client if no role is set
    isAdmin: role === 'admin',
    isClerk: role === 'clerk',
    isClient: role === 'client' || !role,
    isLoaded,
    isSignedIn,
    user
  };
}
