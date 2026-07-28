import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import styled from "styled-components";
import { useAuth } from "@/features/auth/AuthProvider";

function authErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Nie udało się zalogować.";
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  switch (code) {
    case "auth/invalid-email":
      return "Nieprawidłowy adres e-mail.";
    case "auth/user-disabled":
      return "To konto zostało wyłączone.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Nieprawidłowy e-mail lub hasło.";
    case "auth/too-many-requests":
      return "Zbyt wiele prób. Spróbuj ponownie później.";
    default:
      return "Nie udało się zalogować.";
  }
}

export function Login() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      void navigate(from, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <Card>
        <Header>
          <Title>Logowanie</Title>
          <Subtitle>Konto tworzy administrator w panelu Firebase Authentication.</Subtitle>
        </Header>
        <Form onSubmit={(event) => void onSubmit(event)}>
          <Field>
            <Label htmlFor="login-email">E-mail</Label>
            <Input id="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
          </Field>
          <Field>
            <Label htmlFor="login-password">Hasło</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {error ? <ErrorMessage role="alert">{error}</ErrorMessage> : null}
          <Submit type="submit" disabled={submitting || loading}>
            {submitting ? "Logowanie…" : "Zaloguj się"}
          </Submit>
        </Form>
      </Card>
    </Page>
  );
}

const Page = styled.div`
  display: flex;
  justify-content: center;
  padding: 3rem 1.5rem;
`;

const Card = styled.section`
  width: min(100%, 26rem);
  border: 1px solid #c5b8a4;
  background: #faf7f2;
  box-shadow: 0 8px 24px rgba(28, 42, 34, 0.08);
  padding: 1.75rem;
`;

const Header = styled.header`
  margin-bottom: 1.5rem;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.2;
`;

const Subtitle = styled.p`
  margin: 0.55rem 0 0;
  color: #5c6b62;
  font-size: 0.88rem;
  line-height: 1.45;
`;

const Form = styled.form`
  display: grid;
  gap: 1rem;
`;

const Field = styled.div`
  display: grid;
  gap: 0.4rem;
`;

const Label = styled.label`
  color: #3d4a42;
  font-size: 0.82rem;
  font-weight: 600;
`;

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #c5b8a4;
  background: #fff;
  color: #1c2a22;
  padding: 0.7rem 0.8rem;
  font: inherit;
  font-size: 0.95rem;

  &:focus {
    outline: 2px solid #3d5a4c;
    outline-offset: 1px;
  }
`;

const ErrorMessage = styled.p`
  margin: 0;
  color: #8b3a2f;
  font-size: 0.88rem;
  line-height: 1.4;
`;

const Submit = styled.button`
  margin-top: 0.25rem;
  border: 0;
  background: #3d5a4c;
  color: #f7f4ef;
  padding: 0.75rem 1rem;
  font: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #324a3f;
  }

  &:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  &:focus-visible {
    outline: 2px solid #3d5a4c;
    outline-offset: 3px;
  }
`;
