const axios = require('axios');
const qs = require('qs');
const AWS = require('aws-sdk');

// HubSpot API endpoints
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_USER_INFO_URL = "https://api.hubapi.com/oauth/v1/access-tokens/";

// HubSpot credentials
const HUBSPOT_CLIENT_ID = "Your HubSpot app's client ID.";
const HUBSPOT_CLIENT_SECRET = "Your HubSpot app's client secret.";

// DynamoDB setup
const dynamodb = new AWS.DynamoDB.DocumentClient();
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

console.log('DYNAMODB_TABLE:', DYNAMODB_TABLE);

const querystring = require('querystring');

async function webhookHandler(event) {
	if (event.resource === "/install") {
		return await installHandler(event);
	}
	const httpMethod = event.httpMethod;

	switch (httpMethod) {
		case 'GET':
			return await crmCardHandler(event);
		case 'POST':
			// Parse the URL-encoded payload for POST method
			const body = querystring.parse(event.body);
			console.log("Parsed body:", body);
			return await saveToDbHandler(body);
		default:
			return {
				statusCode: 405,
					body: JSON.stringify({
						error: 'Method not allowed'
					})
			};
	}
}

async function getAccessToken(portalId) {
    try {
        // Retrieve the user's credentials from DynamoDB
        const credentials = await dynamodb.get({
            TableName: 'HubSpotUsers',
            Key: {
                id: portalId,
            },
        }).promise();

        if (!credentials.Item) {
            throw new Error("No credentials found for the provided portalId");
        }

        let {
            access_token,
            refresh_token,
            expires_at
        } = credentials.Item;

        // Check if the access token is expired
        if (Date.now() >= expires_at * 1000) {
            // Refresh the access token
            const response = await axios.post(HUBSPOT_TOKEN_URL, qs.stringify({
                grant_type: 'refresh_token',
                client_id: HUBSPOT_CLIENT_ID,
                client_secret: HUBSPOT_CLIENT_SECRET,
                refresh_token: refresh_token,
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
                }
            });

            // Update the access token and its expiration time
            access_token = response.data.access_token;
            expires_at = Math.floor(Date.now() / 1000) + response.data.expires_in - 300;

            await dynamodb.update({
                TableName: 'HubSpotUsers',
                Key: {
                    id: portalId,
                },
                UpdateExpression: 'set access_token = :a, expires_at = :e',
                ExpressionAttributeValues: {
                    ':a': access_token,
                    ':e': expires_at,
                },
            }).promise();
        }

        return access_token;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

const saveToDbHandler = async (body) => {
    try {
        console.log('Parsed body:', body);

        const {
            userId,
            userEmail,
            associatedObjectId,
            associatedObjectType,
            portalId,
        } = body;

        // Extract the access token using the portalId
        const accessToken = await getAccessToken(portalId);

		const hubspotResponse = await axios.get(
			`https://api.hubapi.com/crm/v3/objects/contacts/${associatedObjectId}?archived=false`, 
			{
				headers: {
					'Accept': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);
		
		console.log('HubSpot response:', hubspotResponse.data);

		const {
			firstname,
			lastname,
			email
		} = hubspotResponse.data.properties;

		const dynamoDb = new AWS.DynamoDB.DocumentClient();
		await dynamoDb.put({
			TableName: "HubSpotObjects",
			Item: {
				id: associatedObjectId,
				firstname,
				lastname,
				email,
				portalId,
			},
		}).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Data saved successfully'
            }),
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Internal Server Error'
            }),
        };
    }
};

async function crmCardHandler(event) {
	// Extract parameters from the event
	const userId = event.queryStringParameters.userId;
	const userEmail = event.queryStringParameters.userEmail;
	const associatedObjectId = event.queryStringParameters.associatedObjectId;
	const associatedObjectType = event.queryStringParameters.associatedObjectType;

	// Prepare a sample response
	const response_data = {
		results: [{
			objectId: associatedObjectId,
			title: "Sample Title",
			link: "http://example.com",
			created: "2022-05-01",
			actions: [{
				type: "ACTION_HOOK",
				httpMethod: "POST",
				associatedObjectProperties: [],
				uri: "API Gateway > APIs > sam-app > Stages/Prod/webhook",
				label: "Save to DB"
			}]
		}],
		primaryAction: {
			type: "ACTION_HOOK",
			httpMethod: "POST",
			uri: "API Gateway > APIs > sam-app > Stages/Prod/webhook",
			label: "Save to DB"
		}
	};

	return {
		statusCode: 200,
		body: JSON.stringify(response_data)
	};
}

// Lambda handler
exports.handler = async (event) => {
	return await webhookHandler(event);
};

// Install Handler to manage OAuth 2.0 authorization code flow
async function installHandler(event) {
	const code = event.queryStringParameters.code;

	try {
		if (!code) {
			throw new Error("Authorization code not provided");
		}

		// Exchange the authorization code for access and refresh tokens
		const tokenResponse = await axios.post(HUBSPOT_TOKEN_URL, qs.stringify({
			grant_type: 'authorization_code',
			client_id: HUBSPOT_CLIENT_ID,
			client_secret: HUBSPOT_CLIENT_SECRET,
			redirect_uri: 'API Gateway > APIs > sam-app > Stages/Prod/install',
			code: code,
		}), {
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
			}
		});

		const {
			access_token,
			refresh_token,
			expires_in
		} = tokenResponse.data;

		// Get the portalId using the access token
		const userInfoResponse = await axios.get(`${HUBSPOT_USER_INFO_URL}${access_token}`);
		const portalId = userInfoResponse.data.hub_id.toString();

		// Save the tokens and expiration time to the DynamoDB table
		const expiresAt = Math.floor(Date.now() / 1000) + expires_in - 300; // Subtracting 300 seconds to account for any delays
		await dynamodb.put({

			TableName: "HubSpotUsers",

			Item: {
				id: portalId,
				access_token: access_token,
				refresh_token: refresh_token,
				expires_at: expiresAt,
			},
		}).promise();

		return {
			statusCode: 200,
			body: JSON.stringify({
				message: "Installation successful. Tokens have been saved."
			}),
		};
	} catch (error) {
		console.error(error);
		return {
			statusCode: 500,
			body: JSON.stringify({
				message: error.message
			}),
		};
	}
}
