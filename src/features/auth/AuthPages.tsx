import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Checkbox, Input, Tabs } from "lojee-ui";
import { describeApiError } from "../../data/accountApi";
import { getServerUrl } from "../../data/serverSettings";
import { InlineError } from "../../components/InlineError";
import { useAuth } from "./AuthContext";
import { serverAuthProvider } from "./serverAuthProvider";

function useReturnTo(): string {
  const state = useLocation().state as { from?: unknown } | null;
  return typeof state?.from === "string" && state.from.startsWith("/") && !state.from.startsWith("//") ? state.from : "/";
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4 text-fg">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center text-lg font-semibold tracking-wide">Mnemonis</div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, htmlFor }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function CredentialsForm({ mode, registrationOpen, onDone }: { mode: "signIn" | "register"; registrationOpen: boolean; onDone: () => void }) {
  const { signIn, register } = useAuth();
  const uid = useId();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";

  if (isRegister && !registrationOpen) {
    return <Alert variant="info" title="Registration is closed">This server is not accepting new accounts. Ask its operator, or sign in with an existing account.</Alert>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) return setError("Enter your email and password.");
    if (isRegister && password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register({ email, password, displayName, remember });
      else await signIn({ email, password, remember });
      onDone();
    } catch (err) {
      setError(describeApiError(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
      {isRegister && (
        <Field label="Display name (optional)" htmlFor={`${uid}-name`}>
          <Input id={`${uid}-name`} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
      )}
      <Field label="Email" htmlFor={`${uid}-email`}>
        <Input id={`${uid}-email`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor={`${uid}-pw`}>
        <Input
          id={`${uid}-pw`}
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {isRegister && (
        <>
          <Field label="Confirm password" htmlFor={`${uid}-confirm`}>
            <Input id={`${uid}-confirm`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <p className="text-xs text-fg-muted">At least 12 characters. Use a password you do not use anywhere else.</p>
        </>
      )}
      <Checkbox label="Stay signed in on this device" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
      <InlineError message={error} />
      <Button type="submit" disabled={busy} className="w-full">
        {isRegister ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}

export function SignInPage() {
  const { status, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const to = useReturnTo();
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void serverAuthProvider.config().then((c) => {
      if (!cancelled) setRegistrationOpen(c.registrationOpen);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "signedIn") return <Navigate to={to} replace />;
  const go = () => navigate(to, { replace: true });
  const form = (m: "signIn" | "register") => <CredentialsForm mode={m} registrationOpen={registrationOpen} onDone={go} />;

  return (
    <AuthFrame>
      {notice && (
        <Alert variant="warning" title="Signed out" closable onClose={clearNotice}>
          {notice}
        </Alert>
      )}
      <Tabs
        index={tab}
        onChange={(i) => setTab(i)}
        tabs={[
          { label: "Sign in", content: <div className="pt-4">{form("signIn")}</div> },
          { label: "Register", content: <div className="pt-4">{form("register")}</div> },
        ]}
      />
      <p className="text-center text-xs text-fg-muted">
        Server: <code>{getServerUrl()}</code>
      </p>
    </AuthFrame>
  );
}

/** The old /sign-up address: registration now lives in the Register tab on /sign-in. */
export function SignUpPage() {
  const state = useLocation().state;
  return <Navigate to="/sign-in" replace state={state} />;
}
