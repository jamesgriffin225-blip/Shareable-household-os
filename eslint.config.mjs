import next from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"] },
  ...next,
  ...typescript,
  {
    rules: {
      // Route handlers and the Google/Graph clients pass around JSON whose
      // shape belongs to somebody else's API.
      "@typescript-eslint/no-explicit-any": "off",

      // Every setState-in-effect in this app is the case the rule's own docs
      // allow — subscribing to an external system (the server, on a poll) and
      // setting state from the callback. There is no synchronous cascade
      // here, and the rule cannot see the await between the two.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
