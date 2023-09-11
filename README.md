# HubSpot APP using AWS SAM

## Description
A simple HubSpot app developed for a HubSpot Developer account. The app leverages AWS SAM to facilitate the storage of HubSpot contact properties in AWS DynamoDB tables. With the integration of AWS services, it enhances the functionality of HubSpot by seamlessly managing user credentials and storing critical contact data securely.

## Usage
### Environment Variables
Set up the necessary environment variables to ensure smooth operation:
 - `HUBSPOT_TOKEN_URL`: The URL used for token-related operations.
 - `HUBSPOT_USER_INFO_URL`: The URL to fetch user info.
 - `HUBSPOT_CLIENT_ID`: Your HubSpot app's client ID.
 - `HUBSPOT_CLIENT_SECRET`: Your HubSpot app's client secret.

## DynamoDB Tables
The app utilizes two DynamoDB tables:
 - **HubSpotUsers:** To store the credentials such as access_token and refresh_token of individual users installing the app.
 - **HubSpotObjects:** To store the contact information retrieved from the portals of individual users.

## Refreshing Access Tokens
A mechanism is in place to manage the access_token for individual users. It refreshes expired tokens and updates the new `access_token` in the `HubSpotUsers` table, ensuring uninterrupted service.

## Storing Contact Properties
The app features a CRM Card button, which, when clicked, pushes the contact properties to the `HubSpotObjects` table along with the individual users' `portalId`.
