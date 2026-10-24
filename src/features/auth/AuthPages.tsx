import { useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, LoginForm, SignupForm } from "lojee-ui";
import { InlineError } from "../../components/InlineError";
import { useAuth } from "./AuthContext";

function useReturnTo(): string {
  const state = useLocation().state as { from?: unknown } | null;
  return typeof state?.from === "string" && state.from.startsWith("/") && !state.from.startsWith("//") ? state.from : "/";
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4 text-fg">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center text-lg font-semibold tracking-wide">Mnemonis</div>
        <Alert variant="warning" title="Local profile only">
          This creates a profile stored in this browser. There is no server: nothing is transmitted, no password is stored or
          checked, and your data is not synced anywhere.
        </Alert>
        {children}
      </div>
    </div>
  );
}

function DemoButton({ onDone }: { onDone: () => void }) {
  const { continueAsGuest } = useAuth();
  return (
    <Button
      variant="outline"
      onClick={() => {
        continueAsGuest();
        onDone();
      }}
    >
      Continue in local demo mode
    </Button>
  );
}

export function SignInPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const to = useReturnTo();
  const [error, setError] = useState<string | null>(null);
  if (user) return <Navigate to={to} replace />;
  return (
    <AuthFrame>
      <LoginForm
        title="Sign in to your local profile"
        description="Enter the email of the profile on this device. Any password value is ignored and never stored."
        submitLabel="Sign in locally"
        showRemember={false}
        showForgotPassword={false}
        onSubmit={({ email }) => {
          try {
            signIn({ email });
            navigate(to, { replace: true });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        footer={
          <div className="space-y-2 text-center text-sm">
            <InlineError message={error} />
            <div>
              No local profile? <Link className="underline" to="/sign-up">Create one</Link>
            </div>
            <DemoButton onDone={() => navigate(to, { replace: true })} />
          </div>
        }
      />
    </AuthFrame>
  );
}

export function SignUpPage() {
  const { user, signUp } = useAuth();
  const navigate = useNavigate();
  const to = useReturnTo();
  const [error, setError] = useState<string | null>(null);
  if (user) return <Navigate to={to} replace />;
  return (
    <AuthFrame>
      <SignupForm
        title="Create a local profile"
        description="Stored only in this browser. No account is created on any server."
        submitLabel="Create local profile"
        mismatchError="Passwords do not match."
        onSubmit={({ name, email }) => {
          try {
            signUp({ displayName: name, email });
            navigate(to, { replace: true });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        footer={
          <div className="space-y-2 text-center text-sm">
            <InlineError message={error} />
            <div>
              Already have a local profile? <Link className="underline" to="/sign-in">Sign in</Link>
            </div>
            <DemoButton onDone={() => navigate(to, { replace: true })} />
          </div>
        }
      />
    </AuthFrame>
  );
}
