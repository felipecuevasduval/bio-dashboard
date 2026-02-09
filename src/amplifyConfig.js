export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: "eu-south-2_wLj1GlAv4",
      userPoolClientId: "121jl2ivp6arcq6pq7ju0f8d1r",
      loginWith: {
        oauth: {
          domain: "eu-south-2wlj1glav4.auth.eu-south-2.amazoncognito.com",
          scopes: ["openid", "email", "profile"],
          redirectSignIn: [
            "http://localhost:5173/",
          ],
          redirectSignOut: [
            "http://localhost:5173/",
          ],
          responseType: "code",
        },
      },
    },
  },
};
