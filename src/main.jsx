import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import App from "./App.jsx";
import "./index.css";
import { amplifyConfig } from "./amplifyConfig.js";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: amplifyConfig.userPoolId,
      userPoolClientId: amplifyConfig.userPoolWebClientId,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
