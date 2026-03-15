import { exportJWK, generateKeyPair } from "jose";

const kid = process.argv[2]?.trim() || "reveal-answer-key";

const { privateKey, publicKey } = await generateKeyPair("RS256");
const privateJwk = await exportJWK(privateKey);
const publicJwk = await exportJWK(publicKey);

privateJwk.alg = "RS256";
privateJwk.use = "sig";
privateJwk.kid = kid;

publicJwk.alg = "RS256";
publicJwk.use = "sig";
publicJwk.kid = kid;

const stateSecret = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

console.log("LTI_TOOL_PRIVATE_JWK=");
console.log(JSON.stringify(privateJwk));
console.log("");
console.log("LTI_TOOL_PUBLIC_JWK=");
console.log(JSON.stringify(publicJwk));
console.log("");
console.log("LTI_STATE_SECRET=");
console.log(stateSecret);
