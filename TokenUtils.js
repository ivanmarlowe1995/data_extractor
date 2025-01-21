const SERVICE_ACCOUNT_KEY = {
    "type": "service_account",
    "project_id": userProperties["BIGQUERY_PROJECT_ID"],
    "private_key_id": userProperties["PROJECT_KEY_ID"],
    "private_key": userProperties["PROJECT_PRIVATE_KEY"].replaceAll('\\n', '\n'),
    "client_email": userProperties["PROJECT_CLIENT_EMAIL"],
    "client_id": userProperties["PROJECT_CLIENT_ID"],
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": userProperties["PROJECT_CLIENT_CERT_URL"],
    "universe_domain": "googleapis.com"
};

function getOAuthToken(serviceAccountKey) {
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const jwt = createJwt(serviceAccountKey);

    const options = {
        method: 'post',
        payload: {
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        }
    };

    const response = UrlFetchApp.fetch(tokenUrl, options);
    const token = JSON.parse(response.getContentText());

    return token.access_token;
}

function createJwt(serviceAccountKey) {
    const header = {
        alg: "RS256",
        typ: "JWT"
    };

    const now = Math.floor(new Date().getTime() / 1000);
    const payload = {
        iss: serviceAccountKey.client_email,
        scope: "https://www.googleapis.com/auth/bigquery",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };

    const unsignedToken = base64Encode(JSON.stringify(header)) + '.' + base64Encode(JSON.stringify(payload));
    const signature = Utilities.computeRsaSha256Signature(unsignedToken, serviceAccountKey.private_key);
    const signedToken = unsignedToken + '.' + base64Encode(signature);

    return signedToken;
}

function base64Encode(str) {
    return Utilities.base64EncodeWebSafe(str).replace(/=+$/, '');
}