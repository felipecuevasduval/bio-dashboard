import React from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import Dashboard from "./Dashboard.jsx";
import "./App.css";

export default function App() {
  return (
    <div className="appShell">
      <Authenticator hideSignUp>
        {({ user, signOut }) => (
          <Dashboard user={user} signOut={signOut} />
        )}
      </Authenticator>
    </div>
  );
}
