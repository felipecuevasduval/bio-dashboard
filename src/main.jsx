// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import App from "./App.jsx";
import { config } from "./amplifyConfig.js";

import "@aws-amplify/ui-react/styles.css";
import "./index.css";

Amplify.configure({
  Auth: {
    Cognito: {
      region: config.region,
      userPoolId: config.userPoolId,
      userPoolClientId: config.clientId,
      loginWith: {
        oauth: {
          domain: config.cognitoDomain.replace("https://", ""),
          scopes: config.scopes,
          redirectSignIn: [config.redirectUriDev, config.redirectUriProd],
          redirectSignOut: [config.redirectUriDev, config.redirectUriProd],
          responseType: "code",
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
