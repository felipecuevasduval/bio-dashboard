import React, { useEffect } from "react";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import Dashboard from "./Dashboard.jsx";
import "./App.css";

function AuthHero() {
  const { route } = useAuthenticator((c) => [c.route]);
  if (route === "authenticated") return null;

  return (
    <header id="header">
      <div className="content">
        <h1>Bio Dashboard</h1>
        <p>
          Dashboard para ver EDA / ECG / HR en tiempo real.
        </p>
        <ul className="actions">
          <li>
            <a href="#login" className="button primary icon solid fa-sign-in-alt">
              Sign in
            </a>
          </li>
        </ul>
      </div>

      {/* imagen del template (puedes cambiarla) */}
      <div className="image phone">
        <div className="inner">
          <img src="/fractal/images/screen.jpg" alt="preview" />
        </div>
      </div>
    </header>
  );
}

export default function App() {
  useEffect(() => {
    // Fractal usa is-preload, lo removemos después de montar React
    document.body.classList.remove("is-preload");
  }, []);

  return (
    <div className="appShell authPage">
      <Authenticator
        hideSignUp
        components={{
          Header: AuthHero,
          SignIn: { Footer: () => null }, // elimina cualquier hint/signup en el footer
        }}
      >
        {({ user, signOut }) => (
          <div className="page">
            <Dashboard user={user} signOut={signOut} />
          </div>
        )}
      </Authenticator>

      {/* Ancla para el botón "Sign in" */}
      <div id="login" className="authWrap" />
    </div>
  );
}
