import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "@/features/auth/AuthProvider";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoading>Sprawdzanie sesji…</AuthLoading>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function AuthLoading({ children }: { children: string }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "2rem 1.5rem",
        color: "#5c6b62",
        fontSize: "0.95rem",
      }}
    >
      {children}
    </p>
  );
}
