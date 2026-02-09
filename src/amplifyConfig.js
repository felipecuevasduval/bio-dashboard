// src/amplifyConfig.js
export const amplifyConfig = {
  region: "eu-south-2",

  userPoolId: "eu-south-2_wLj1GlAv4",
  userPoolWebClientId: "121jl2ivp6arcq6pq7ju0f8d1r",

  // NO uses Hosted UI aquí si estás usando Authenticator "directo".
  // Si luego quieres Hosted UI, lo configuramos aparte.
};

export const config = {
  region: "eu-south-2",
  userPoolId: "eu-south-2_wLj1GlAv4",
  clientId: "121jl2ivp6arcq6pq7ju0f8d1r",
  cognitoDomain: "https://eu-south-2wlj1glav4.auth.eu-south-2.amazoncognito.com",
  scopes: ["openid", "email"],
  redirectUriDev: "http://localhost:5173/",
  redirectUriProd: "https://main.dopckgtccvn0w.amplifyapp.com/",
  apiBaseUrl: "https://mnd77hcxpc.execute-api.eu-south-2.amazonaws.com",
};
