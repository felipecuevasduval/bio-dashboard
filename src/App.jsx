// src/App.jsx
import React from "react";
import { Authenticator, View } from "@aws-amplify/ui-react";
import Dashboard from "./Dashboard.jsx";
import "./App.css";

export default function App() {
  return (
    <View className="appShell">
      <Authenticator hideSignUp>
        {({ signOut, user }) => (
          <Dashboard user={user} signOut={signOut} />
        )}
      </Authenticator>
    </View>
  );
}
